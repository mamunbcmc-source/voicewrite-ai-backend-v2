# VoiceWrite AI — Backend (Phase 2 + Phase 3)

Secure backend that the mobile app calls for:
- `POST /api/transcribe` — audio → text (Google Cloud Speech-to-Text, Bangla + English)
- `POST /api/ai-write` — transcript + mode → AI-written result (Claude)

This exists so the mobile app **never** holds Google Cloud or Anthropic API
keys directly (per the project's security rule).

## Setup
```bash
cd voicewrite-backend
npm install
cp .env.example .env
```

Then fill in `.env`:
1. **Google Cloud Speech-to-Text**: create a project at console.cloud.google.com,
   enable the "Cloud Speech-to-Text API", create a service account with the
   "Cloud Speech Client" role, download its JSON key, save it next to this
   README as `service-account.json`.
2. **Anthropic API key**: from console.anthropic.com → API Keys.
3. **Firebase service account**: Firebase Console → Project Settings →
   Service Accounts → Generate new private key, save as
   `firebase-service-account.json`.

Run locally:
```bash
npm run dev
```

## Deploying (so the mobile app can reach it from a real phone)
Pick one:
- **Render / Railway** — easiest, push this folder as a Node web service,
  add the same env vars in their dashboard.
- **Google Cloud Run** — natural fit since you're already using Google
  Cloud for STT; `gcloud run deploy` from this folder.

Once deployed, put the resulting HTTPS URL into the mobile app's
`src/services/apiService.ts` as `API_BASE_URL`.

## Important notes
- `DEV_MODE_NO_AUTH` in `server.js` is on by default so you can test with
  `curl` before the mobile app's Firebase login is fully wired up. **Turn
  it off** before any real deployment — otherwise anyone can call your paid
  STT/AI endpoints.
- The Speech-to-Text `encoding`/`sampleRateHertz` in `routes/transcribe.js`
  must match whatever format `expo-av` records in on the mobile side (see
  the mobile project's `VoiceRecordScreen.tsx` comments) — mismatches are
  the most common cause of empty transcripts.
- Automatic Bangla/English language detection uses Google's
  `alternativeLanguageCodes`. It picks the best-matching language per audio
  chunk; true single-sentence Bangla+English code-switching (like "meeting
  আছে at 3pm") is handled reasonably well by the bn-BD model itself since
  English loanwords are common in Bangla speech, but isn't perfect —
  something to evaluate with real test recordings.
