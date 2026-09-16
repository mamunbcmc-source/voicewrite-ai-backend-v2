// POST /api/transcribe
// Uses Groq's hosted Whisper API (OpenAI-compatible) to turn a recorded
// meeting (or an uploaded audio file) into text. Groq's free tier needs no
// credit card, which is why this is used instead of Google Cloud
// Speech-to-Text for now — this can be swapped back to Google Cloud (or
// any other provider) later without touching the frontend, since the
// request/response shape the app expects ({ transcript }) stays the same.

const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');

const router = express.Router();

// Fire-and-forget usage counter — safe no-op until Firebase Admin is
// actually initialized (FIREBASE_SERVICE_ACCOUNT_JSON set) and the caller
// is a real signed-in user (not the DEV_MODE_NO_AUTH placeholder).
function bumpUsage(uid, field) {
  if (!admin.apps.length || !uid || uid === 'dev-user') return;
  admin.firestore().collection('users').doc(uid).set(
    { usage: { [field]: admin.firestore.FieldValue.increment(1) } },
    { merge: true }
  ).catch((e) => console.error('usage tracking failed:', e.message));
}
// Groq's free-tier Whisper endpoint hard-caps uploads at 25MB — this stays
// just under that so we get a clear, friendly error from OUR OWN server
// instead of an opaque one from Groq if a recording is too long.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 24 * 1024 * 1024 } });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// "turbo" is faster and still very accurate for Bangla/English; swap to
// 'whisper-large-v3' (no -turbo) if accuracy ever needs to be prioritized
// over speed.
const GROQ_STT_MODEL = 'whisper-large-v3'; // full-quality model — better accuracy than -turbo, especially for Bangla

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
    // NOTE: we force language=bn here. Leaving this blank for Whisper to
    // auto-detect turned out to misidentify Bangla speech as Hindi quite
    // often (the two languages sound close enough that Whisper's language
    // ID gets confused, especially on short/noisy clips) — forcing Bangla
    // fixes that. Whisper still transcribes English words spoken within
    // Bangla speech reasonably well even with language pinned to bn.
    form.append('language', 'bn');
    // A short context "prompt" nudges Whisper's decoding toward plausible,
    // standard Bangla vocabulary for this kind of speech instead of
    // hallucinating similar-sounding nonsense words — a free accuracy
    // improvement, not a guaranteed fix.
    form.append('prompt', 'এটি একটি বাংলা অফিস মিটিং রেকর্ডিং। কথাবার্তা স্বাভাবিক, কথ্য বাংলায়।');
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
    bumpUsage(req.uid, 'transcriptions');
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

// Friendly response for recordings over the 24MB cap (multer's default
// error is a generic LIMIT_FILE_SIZE code) — this needs to be registered
// after the route above so it catches errors multer raised for it.
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'এই recording-টা অনেক বড় (২৪ MB-এর বেশি) — একবারে Convert করা যাচ্ছে না। মিটিংটা কয়েকটা ছোট recording-এ ভাগ করে (Stop করে আবার নতুন Recording শুরু করে) প্রতিটা আলাদা Convert করুন।',
    });
  }
  next(err);
});

module.exports = router;
