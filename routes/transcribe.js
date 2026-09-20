// POST /api/transcribe
// Uses ElevenLabs' Speech-to-Text API (Scribe model) to turn a recorded
// meeting (or an uploaded audio file) into text. Chosen over Groq's free
// Whisper because Groq's Bangla accuracy on casual/conversational speech
// was consistently poor (including misidentifying Bangla as Hindi). Chosen
// over Google Cloud STT and Sarvam AI because it needs no credit card
// (10,000 free credits/month) and Sarvam is geo-blocked in Bangladesh.
// ElevenLabs specifically lists Bangladeshi (Dhaka) accent support for
// Bengali. Response shape stays { transcript } so nothing else changes.

const express = require('express');
const multer = require('multer');

const router = express.Router();
// ElevenLabs doesn't publish a hard file-size cap for this endpoint, but we
// keep a generous limit here as a sanity check / safety net either way.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 24 * 1024 * 1024 } });

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// scribe_v1 is the stable, generally-available model; scribe_v2 exists but
// availability can vary by account — start with v1 for reliability.
const ELEVENLABS_STT_MODEL = 'scribe_v1';

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received.' });
    }
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY is not set on the server.' });
    }

    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    form.append('file', blob, req.file.originalname || 'audio.webm');
    form.append('model_id', ELEVENLABS_STT_MODEL);
    // "ben" = Bengali (ISO-639-3). Pinning this (instead of leaving it for
    // auto-detect) avoids the same Bangla-misidentified-as-Hindi problem we
    // hit with Groq. Scribe still handles English words spoken within
    // Bangla speech reasonably well even with the language pinned.
    form.append('language_code', 'ben');

    const elRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form,
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      throw new Error(`ElevenLabs STT error ${elRes.status}: ${errText}`);
    }

    const data = await elRes.json();
    res.json({ transcript: (data.text || '').trim() });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: 'Speech-to-text failed.', detail: err.message });
  }
});

// Friendly response for recordings over the multer size cap (multer's
// default error is a generic LIMIT_FILE_SIZE code) — registered after the
// route above so it catches errors multer raised for it.
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'এই recording-টা অনেক বড় — একবারে Convert করা যাচ্ছে না। মিটিংটা কয়েকটা ছোট recording-এ ভাগ করে (Stop করে আবার নতুন Recording শুরু করে) প্রতিটা আলাদা Convert করুন।',
    });
  }
  next(err);
});

module.exports = router;
