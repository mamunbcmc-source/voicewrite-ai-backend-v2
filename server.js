require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const transcribeRoute = require('./routes/transcribe');
const aiWriteRoute = require('./routes/aiWrite');
const adminRoute = require('./routes/admin');

// Initialize Firebase Admin so we can verify the ID token the mobile app
// sends with every request (proves the request really comes from a logged
// in user, and which uid — used later for per-user history isolation).
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  admin.initializeApp({
    credential: admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  });
}

const app = express();
app.use(cors());
app.use(express.json());

// --- Auth middleware -------------------------------------------------
// Every mobile request must include: Authorization: Bearer <Firebase ID token>
// DEV_MODE_NO_AUTH lets you test /api routes with curl before Firebase is
// wired up on the mobile side — turn this off before going anywhere near
// production.
const DEV_MODE_NO_AUTH = true;

async function requireAuth(req, res, next) {
  if (DEV_MODE_NO_AUTH) {
    req.uid = 'dev-user';
    return next();
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

app.use('/api', requireAuth, transcribeRoute);
app.use('/api', requireAuth, aiWriteRoute);
app.use('/api', requireAuth, adminRoute);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`VoiceWrite AI backend running on port ${PORT}`));
