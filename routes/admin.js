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
