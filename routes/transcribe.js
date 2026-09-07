// POST /api/transcribe
// Receives a short audio chunk from the mobile app and returns text.
// Uses Google Cloud Speech-to-Text with alternativeLanguageCodes so a
// single request can come back as Bangla OR English — this is the closest
// production-grade equivalent to "automatic language detection" available
// today. True mid-sentence Bangla+English code-switching in one utterance
// is still an evolving area for STT vendors; this setup gives the best
// practical result: whichever language dominates the audio chunk gets
// picked up correctly, and English words embedded in Bangla speech
// (common in real Bangla speech) are generally handled by the bn-BD model
// itself reasonably well.

const express = require('express');
const multer = require('multer');
const speech = require('@google-cloud/speech');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new speech.SpeechClient();

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received.' });
    }

    const audioBytes = req.file.buffer.toString('base64');

    // Defaults match the mobile app's AMR_WB recording. The browser
    // prototype sends encoding=WEBM_OPUS instead (see apiService.ts) —
    // WEBM_OPUS carries its own sample rate in the file, so
    // sampleRateHertz can be omitted for it.
    const encoding = req.body.encoding || 'AMR_WB';
    const config = {
      encoding,
      languageCode: 'bn-BD',
      alternativeLanguageCodes: ['en-US'],
      enableAutomaticPunctuation: true,
      model: 'default',
    };
    if (encoding !== 'WEBM_OPUS') {
      config.sampleRateHertz = Number(req.body.sampleRateHertz) || 16000;
    }

    const request = {
      audio: { content: audioBytes },
      config,
    };

    const [response] = await client.recognize(request);
    const transcript = (response.results || [])
      .map((r) => r.alternatives[0]?.transcript || '')
      .join(' ')
      .trim();

    res.json({ transcript });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: 'Speech-to-text failed.', detail: err.message });
  }
});

module.exports = router;
