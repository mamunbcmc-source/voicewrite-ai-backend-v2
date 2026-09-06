=== routes/transcribe.js ===

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

    const request = {
      audio: { content: audioBytes },
      config: {
        encoding: 'AMR_WB', // adjust to match the mobile app's recording format (see README)
        sampleRateHertz: 16000,
        languageCode: 'bn-BD',
        alternativeLanguageCodes: ['en-US'],
        enableAutomaticPunctuation: true,
        model: 'default',
      },
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


=== routes/aiWrite.js ===

// POST /api/ai-write
// Takes the raw transcript + a chosen mode, and asks Claude to turn it into
// polished writing. This is where "AI নিজের বুদ্ধি দিয়ে summary বা নতুন কথা
// যোগ করে" happens — the model doesn't just clean up wording, it can
// genuinely summarize, restructure, or expand based on the instruction.

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODE_INSTRUCTIONS = {
  professional: 'এই কথ্য transcript-টিকে একটি পরিমার্জিত, formal ও professional লেখায় রূপান্তর করো। মূল ভাষা (বাংলা/ইংরেজি/মিশ্র) বজায় রাখো।',
  cleanup: 'এই transcript-এর ভুল, পুনরাবৃত্তি ও filler word ঠিক করে পরিষ্কার, স্বাভাবিক লেখায় রূপান্তর করো, মূল অর্থ পরিবর্তন না করে।',
  summary: 'এই transcript-টির একটি সংক্ষিপ্ত সারমর্ম লিখো, মূল পয়েন্টগুলো ধরে রেখে। প্রয়োজনে context বুঝে গুরুত্বপূর্ণ পয়েন্ট স্পষ্ট করে তুলে ধরো।',
  detailed: 'এই transcript-টিকে বিস্তারিত ও সুসংগঠিত লেখায় রূপান্তর করো — প্রয়োজনে প্রাসঙ্গিক ব্যাখ্যা যোগ করে content-টি আরও সম্পূর্ণ করো।',
  email: 'এই transcript-এর content দিয়ে একটি প্রফেশনাল ইমেইল লেখো, উপযুক্ত greeting ও closing সহ।',
  meeting: 'এই transcript-টিকে মিটিং নোট format-এ (আলোচ্য বিষয়, সিদ্ধান্ত, পরবর্তী পদক্ষেপ) সাজাও।',
  todo: 'এই transcript থেকে একটি স্পষ্ট, action-oriented To-Do list তৈরি করো।',
  social: 'এই transcript-এর content দিয়ে একটি সংক্ষিপ্ত, আকর্ষণীয় social media post লেখো।',
};

router.post('/ai-write', async (req, res) => {
  try {
    const { transcript, mode, customInstruction } = req.body;
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'transcript is required.' });
    }

    const instruction = mode === 'custom' && customInstruction
      ? customInstruction
      : MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.cleanup;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `${instruction}\n\nTranscript:\n"""${transcript}"""\n\nশুধু চূড়ান্ত লেখাটি দাও, কোনো preamble ছাড়া।`,
        },
      ],
    });

    const text = message.content.map((b) => b.text || '').join('\n').trim();
    res.json({ result: text });
  } catch (err) {
    console.error('AI write error:', err);
    res.status(500).json({ error: 'AI writing failed.', detail: err.message });
  }
});

module.exports = router;


=== routes/admin.js ===

// Admin-only routes — Phase 5.
// Requires the calling user's Firestore role to be "admin" (checked via
// requireAdmin middleware below, layered on top of requireAuth in server.js).

const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();

async function requireAdmin(req, res, next) {
  try {
    // In DEV_MODE_NO_AUTH (server.js), req.uid is a fake dev id and this
    // check is skipped so the admin endpoints are testable with curl.
    if (req.uid === 'dev-user') return next();

    const doc = await admin.firestore().collection('users').doc(req.uid).get();
    if (!doc.exists || doc.data().role !== 'admin') {
      return res.status(403).json({ error: 'Admin access প্রয়োজন।' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Admin check ব্যর্থ হয়েছে।' });
  }
}

// GET /api/admin/users — list all users
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const snap = await admin.firestore().collection('users').get();
    const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'User list আনা যায়নি।', detail: err.message });
  }
});

// PATCH /api/admin/users/:uid — update role / active status
router.patch('/admin/users/:uid', requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { role, active } = req.body;
    const update = {};
    if (role) update.role = role;
    if (typeof active === 'boolean') update.active = active;
    await admin.firestore().collection('users').doc(uid).set(update, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'User update ব্যর্থ হয়েছে।', detail: err.message });
  }
});

// POST /api/admin/users/:uid/reset-password — send a password reset link
router.post('/admin/users/:uid/reset-password', requireAdmin, async (req, res) => {
  try {
    const userRecord = await admin.auth().getUser(req.params.uid);
    const link = await admin.auth().generatePasswordResetLink(userRecord.email);
    // In production, email this link via your mail provider instead of
    // returning it directly.
    res.json({ resetLink: link });
  } catch (err) {
    res.status(500).json({ error: 'Password reset link তৈরি ব্যর্থ হয়েছে।', detail: err.message });
  }
});

module.exports = router;

