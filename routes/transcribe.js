// POST /api/transcribe
// Uses Groq's hosted Whisper API (OpenAI-compatible) to turn a recorded
// meeting (or an uploaded audio file) into text. Groq's free tier needs no
// credit card, which is why this is used instead of Google Cloud
// Speech-to-Text for now — this can be swapped back to Google Cloud (or
// any other provider) later without touching the frontend, since the
// request/response shape the app expects ({ transcript }) stays the same.

const express = require('express');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// "turbo" is faster and still very accurate for Bangla/English; swap to
// 'whisper-large-v3' (no -turbo) if accuracy ever needs to be prioritized
// over speed.
const GROQ_STT_MODEL = 'whisper-large-v3-turbo';

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received.' });
    }
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not set on the server.' });
    }

    // Groq's endpoint wants a real multipart file upload, not the inline
    // base64 content Google Cloud STT used — Node 18+'s built-in
    // FormData/Blob/fetch handle that without any extra dependency.
    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    form.append('file', blob, req.file.originalname || 'audio.webm');
    form.append('model', GROQ_STT_MODEL);
    // Deliberately no `language` field — this lets Whisper auto-detect
    // Bangla vs English (or a mix) instead of forcing a single language,
    // matching the "automatic language detection" the app promises.
    form.append('response_format', 'json');

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      throw new Error(`Groq STT error ${groqRes.status}: ${errText}`);
    }

    const data = await groqRes.json();
    res.json({ transcript: (data.text || '').trim() });
    // NOTE: speaker diarization ("Speaker 1: ...", "Speaker 2: ...") is not
    // available on Groq's free Whisper endpoint — that was a Google Cloud
    // STT-specific feature. If diarization becomes a hard requirement, this
    // route would need to move back to Google Cloud STT (or add a separate
    // diarization step) for that piece specifically.
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: 'Speech-to-text failed.', detail: err.message });
  }
});

module.exports = router;
