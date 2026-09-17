// POST /api/transcribe
// Uses Sarvam AI's Batch Speech-to-Text API (Saaras model) — a speech
// recognition model built specifically for Indian languages including
// Bangla, with strong Bangla+English code-switching support. Chosen over
// Groq's general-purpose Whisper because Whisper's Bangla accuracy for
// casual/conversational speech was consistently poor (frequent
// misrecognized words, occasional Hindi misdetection). Sarvam's free
// signup credits (no card required) cover a generous amount of testing.
//
// This uses the Batch API (not the 30-second-limited REST endpoint) since
// meeting recordings run well past 30 seconds — Sarvam's Batch API
// supports audio up to 2 hours long. The whole upload → start → poll →
// download flow is handled by the official `sarvamai` SDK.

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const admin = require('firebase-admin');
const { SarvamAIClient } = require('sarvamai');

const router = express.Router();
// Sarvam's Batch API documents a 2-hour audio duration limit rather than a
// specific file-size cap; this stays generous while still protecting the
// server from wildly oversized uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

// Fire-and-forget usage counter — safe no-op until Firebase Admin is
// initialized and the caller is a real signed-in user.
function bumpUsage(uid, field) {
  if (!admin.apps.length || !uid || uid === 'dev-user') return;
  admin.firestore().collection('users').doc(uid).set(
    { usage: { [field]: admin.firestore.FieldValue.increment(1) } },
    { merge: true }
  ).catch((e) => console.error('usage tracking failed:', e.message));
}

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  let tmpFilePath;
  let outDir;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received.' });
    }
    if (!SARVAM_API_KEY) {
      return res.status(500).json({ error: 'SARVAM_API_KEY is not set on the server.' });
    }

    // The SDK's uploadFiles() expects a file path on disk, not a Buffer —
    // write the uploaded audio to a temp file first.
    tmpFilePath = path.join(
      os.tmpdir(),
      `meeting-${Date.now()}-${Math.random().toString(36).slice(2)}.webm`
    );
    fs.writeFileSync(tmpFilePath, req.file.buffer);

    const client = new SarvamAIClient({ apiSubscriptionKey: SARVAM_API_KEY });

    // language_code is pinned to Bangla (not auto-detect) — the same
    // lesson learned with Groq: auto-detection on casual/short clips was
    // prone to misidentifying Bangla as a different language.
    const job = await client.speechToTextJob.createJob({
      model: 'saaras:v3',
      mode: 'transcribe',
      language_code: 'bn-IN',
    });

    await job.uploadFiles({ filePaths: [tmpFilePath] });
    await job.start();
    // Kept well under typical platform request-timeout ceilings. Sarvam's
    // batch jobs usually process much faster than real-time, so this
    // comfortably covers a good while of meeting audio — but a genuinely
    // very long recording could still exceed it. If that turns out to be
    // a real problem in practice, this needs to move to an async
    // job-id + client-side polling design instead of blocking one request.
    await job.waitUntilComplete({ pollInterval: 4, timeout: 100 });

    const fileResults = await job.getFileResults();
    if (!fileResults || !fileResults.successful || !fileResults.successful.length) {
      const failMsg = fileResults?.failed?.[0]?.error_message || 'transcription job did not complete successfully';
      throw new Error(failMsg);
    }

    outDir = path.join(
      os.tmpdir(),
      `sarvam-out-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(outDir, { recursive: true });
    await job.downloadOutputs({ outputDir: outDir });

    const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.json'));
    let transcript = '';
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf-8'));
      transcript += (data.transcript || '') + ' ';
    }

    bumpUsage(req.uid, 'transcriptions');
    res.json({ transcript: transcript.trim() });
  } catch (err) {
    console.error('Transcribe error (Sarvam):', err);
    const isTimeout = /timeout/i.test(err.message || '');
    res.status(500).json({
      error: isTimeout
        ? 'Transcription-এ প্রত্যাশার চেয়ে বেশি সময় লাগছে — কিছুক্ষণ পর আবার চেষ্টা করুন, অথবা মিটিংটা ছোট অংশে ভাগ করুন।'
        : 'Speech-to-text failed.',
      detail: err.message,
    });
  } finally {
    if (tmpFilePath) { try { fs.unlinkSync(tmpFilePath); } catch (e) {} }
    if (outDir) { try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {} }
  }
});

module.exports = router;
