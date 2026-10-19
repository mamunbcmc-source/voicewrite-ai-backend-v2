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
    if (req.params.uid === req.uid) {
      return res.status(400).json({ error: 'নিজের account নিজে মুছে ফেলা যাবে না।' });
    }
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

// PATCH /api/admin/users/:uid — update name / email / password / role / active
router.patch('/admin/users/:uid', requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const isSelf = uid === req.uid;
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const email = typeof body.email === 'string' ? body.email.trim() : undefined;
    const password = typeof body.password === 'string' ? body.password.trim() : undefined;
    const role = body.role;
    const active = body.active;

    if (role !== undefined && role !== 'admin' && role !== 'employee') {
      return res.status(400).json({ error: 'Role শুধু admin বা employee হতে পারে।' });
    }
    if (email !== undefined && !email) {
      return res.status(400).json({ error: 'Email খালি রাখা যাবে না।' });
    }
    if (password !== undefined && password.length < 6) {
      return res.status(400).json({ error: 'password অন্তত ৬ অক্ষরের হতে হবে।' });
    }
    // Safety: an admin cannot lock themselves out of the Admin Panel.
    if (isSelf && ((role !== undefined && role !== 'admin') || active === false)) {
      return res.status(400).json({ error: 'নিজের account-এর Role বদলানো বা Suspend করা যাবে না।' });
    }

    // 1) Firebase Authentication (email / password / display name)
    const authUpdate = {};
    if (email !== undefined) authUpdate.email = email;
    if (password !== undefined) authUpdate.password = password;
    if (name !== undefined) authUpdate.displayName = name;
    if (Object.keys(authUpdate).length) {
      await admin.auth().updateUser(uid, authUpdate);
      // After a password change, sign the employee out everywhere so the old
      // password stops working immediately (not for the admin's own session).
      if (password !== undefined && !isSelf) {
        await admin.auth().revokeRefreshTokens(uid);
      }
    }

    // 2) Firestore profile (what the app reads for name / role / active)
    const update = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    if (role !== undefined) update.role = role;
    if (typeof active === 'boolean') update.active = active;
    if (Object.keys(update).length) {
      await admin.firestore().collection('users').doc(uid).set(update, { merge: true });
    }
    res.json({ ok: true });
  } catch (err) {
    let message = 'User update ব্যর্থ হয়েছে।';
    if (err.code === 'auth/email-already-exists') {
      message = 'এই email দিয়ে already আরেকটা account আছে — অন্য email দিন।';
    } else if (err.code === 'auth/invalid-email') {
      message = 'Email-টা সঠিক ফরম্যাটে নেই।';
    } else if (err.code === 'auth/invalid-password') {
      message = 'Password গ্রহণযোগ্য নয় — অন্তত ৬ অক্ষর দিন।';
    } else if (err.code === 'auth/user-not-found') {
      message = 'এই user আর পাওয়া যাচ্ছে না।';
    }
    res.status(500).json({ error: message, detail: err.message });
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
