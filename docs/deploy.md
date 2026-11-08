# Deploy (Firebase Hosting)

Status: config ready; first deploy needs Q2 (Firebase project + login).

## Prereqs (user)

1. `npm i -g firebase-tools` (Node 26+) and `firebase login`.
2. Firebase console → create/select project → AI Services → AI Logic →
   guided setup → Gemini Developer API (free tier, no billing).
3. AI Logic → App Check → register a debug token for localhost dev.
4. Cloud console → Security → reCAPTCHA → create an Enterprise site key for
   the Hosting domain (never add localhost — localhost uses the debug token
   from step 3; the debug flow still needs the site key as its provider).
5. Copy `.env.example` to `.env` and fill `VITE_FIREBASE_*`,
   `VITE_APPCHECK_SITE_KEY`, and `VITE_APPCHECK_DEBUG_TOKEN`
   (never commit `.env`).

## Link the project (once)

```bash
firebase use --add   # pick the Q2 project; writes .firebaserc (committed)
```

## Deploy

```bash
npm run deploy   # build + firebase deploy --only hosting
curl -s -o /dev/null -w "%{http_code}\n" https://<site>.web.app  # → 200
```

## Rollback

```bash
firebase hosting:rollback   # or redeploy any green commit: git checkout <sha> && npm run deploy
```
