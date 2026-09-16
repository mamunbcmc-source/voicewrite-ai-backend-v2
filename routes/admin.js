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

// POST /api/admin/users — create a new employee account
router.post('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email ও password আবশ্যক।' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password অন্তত ৬ অক্ষরের হতে হবে।' });
    }
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name || '',
    });
    await admin.firestore().collection('users').doc(userRecord.uid).set({
      email,
      name: name || '',
      role: role === 'admin' ? 'admin' : 'employee',
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      usage: { transcriptions: 0, aiWrites: 0 },
    });
    res.json({ uid: userRecord.uid });
  } catch (err) {
    let message = 'User তৈরি করা যায়নি।';
    if (err.code === 'auth/email-already-exists') {
      message = 'এই email দিয়ে already একটা account আছে — অন্য email ব্যবহার করুন।';
    } else if (err.code === 'auth/invalid-email') {
      message = 'Email-টা সঠিক ফরম্যাটে নেই।';
    }
    res.status(500).json({ error: message, detail: err.message });
  }
});

// DELETE /api/admin/users/:uid — remove a user entirely (auth + Firestore doc)
router.delete('/admin/users/:uid', requireAdmin, async (req, res) => {
  try {
    await admin.auth().deleteUser(req.params.uid);
    await admin.firestore().collection('users').doc(req.params.uid).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'User মুছে ফেলা যায়নি।', detail: err.message });
  }
});

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
