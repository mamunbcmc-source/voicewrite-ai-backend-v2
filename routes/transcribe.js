// POST /api/transcribe
// Receives a full meeting recording (or a short chunk) from the app and
// returns text. Uses Google Cloud Speech-to-Text with
// alternativeLanguageCodes so a single request can come back as Bangla OR
// English — this is the closest production-grade equivalent to "automatic
// language detection" available today. True mid-sentence Bangla+English
// code-switching in one utterance is still an evolving area for STT
// vendors; this setup gives the best practical result: whichever language
// dominates the audio chunk gets picked up correctly, and English words
// embedded in Bangla speech (common in real Bangla speech) are generally
// handled by the bn-BD model itself reasonably well.

const express = require('express');
const multer = require('multer');
const speech = require('@google-cloud/speech');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new speech.SpeechClient();

// When speaker diarization is requested, Google returns word-level speaker
// tags on the LAST result only (each word object has a `speakerTag`), not
// neatly split per-speaker sentences. This groups consecutive same-speaker
// words into "Speaker N: ..." lines, matching the format meeting users
// expect (Speaker 1: ..., Speaker 2: ..., etc).
function formatDiarizedTranscript(results) {
  if (!results.length) return '';
  const lastResult = results[results.length - 1];
  const words = lastResult.alternatives?.[0]?.words || [];
  if (!words.length) {
    // Diarization didn't return word-level tags (can happen on very short
    // or low-quality audio) — fall back to the plain transcript.
    return results.map((r) => r.alternatives[0]?.transcript || '').join(' ').trim();
  }
  const lines = [];
  let currentSpeaker = null;
  let currentWords = [];
  for (const w of words) {
    const tag = w.speakerTag;
    if (tag !== currentSpeaker) {
      if (currentWords.length) lines.push(`Speaker ${currentSpeaker}: ${currentWords.join(' ')}`);
      currentSpeaker = tag;
      currentWords = [];
    }
    currentWords.push(w.word);
  }
  if (currentWords.length) lines.push(`Speaker ${currentSpeaker}: ${currentWords.join(' ')}`);
  return lines.join('\n');
}

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
    const wantsDiarization = req.body.enableSpeakerDiarization === 'true';

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
    if (wantsDiarization) {
      // Speaker diarization currently requires a single languageCode (no
      // alternativeLanguageCodes) on Google Cloud STT — remove it for this
      // request. Diarization accuracy is "best effort", per Google, not
      // guaranteed perfect, especially on mixed Bangla/English speech.
      delete config.alternativeLanguageCodes;
      config.diarizationConfig = {
        enableSpeakerDiarization: true,
        minSpeakerCount: 2,
        maxSpeakerCount: 6,
      };
    }

    const request = {
      audio: { content: audioBytes },
      config,
    };

    // Full meetings can easily run past Google's ~1-minute limit for the
    // synchronous `recognize` call, so this always uses the long-running
    // (asynchronous) operation instead, which supports much longer audio.
    // Note: for very long meetings whose audio no longer fits comfortably
    // in a single inline upload (see the 10MB multer limit above), this
    // would need to move to a Google Cloud Storage-based upload instead of
    // sending `audio.content` inline — a future improvement if long
    // meetings start hitting that ceiling.
    const [operation] = await client.longRunningRecognize(request);
    const [response] = await operation.promise();
    const results = response.results || [];

    const transcript = wantsDiarization
      ? formatDiarizedTranscript(results)
      : results.map((r) => r.alternatives[0]?.transcript || '').join(' ').trim();

    res.json({ transcript });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: 'Speech-to-text failed.', detail: err.message });
  }
});

module.exports = router;
