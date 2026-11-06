# PrivRedact (hybridlens)

Document PII redaction with Firebase AI Logic hybrid inference — an entry for
#BuildHybridAI 2026. Snap a document photo: on-device Gemini Nano extracts and
redacts PII (raw data never leaves the device), then the cloud model writes a
structured summary of the redacted text. Every answer carries its true
`ON_DEVICE` / `IN_CLOUD` routing badge.

Live demo: coming in Phase 5.

## Start

Prerequisite: Node 26+ (firebase@13 requires node ≥24.12).

```bash
npm install
npm run verify   # typecheck + lint + build + test + smoke + banned (offline, no keys)
npm run dev      # http://localhost:5173
```

Local note: if `/tmp` is unwritable on your box, run checks with
`TMPDIR=$HOME/.hl-tmp` (vitest workers honor TMPDIR).

## Scripts

- `npm test` — offline suite, zero network/keys (Firebase SDK mocked).
- `npm run test:live` — keyed live checks under `tests/live/` (needs Firebase
  config + Chrome with the Prompt-API flag; never in the default gate).
- `npm run verify` — full local gate, must exit 0.

## Demo video

`assets/demos/privredact_demo.mp4` (Phase 5) + voiceover via the ai-shorts-kit
edge-tts path.
