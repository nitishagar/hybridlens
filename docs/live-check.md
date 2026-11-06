# Live check record (Phase 4 manual bar)

Status: PENDING — needs Firebase project + App Check debug token (Q2).

## Setup

- [ ] Chrome 156 + flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled + restart
- [ ] Model downloaded (`LanguageModel.availability()` → `available`)
- [ ] `.env` filled from Firebase console (AI Logic → Gemini Developer API)
- [ ] App served (`npm run dev`), DevTools Network recording on

## (a) Recall bar — 2 live fixtures

| Fixture | Every planted PII span redacted or redact-all | Pass/Fail |
|---|---|---|
| invoice | | |
| receipt | | |

Any miss fails the phase until prompt/schema fixed.

## (b) Offline proof

- [ ] WiFi off → ONLY_ON_DEVICE redact succeeds
- [ ] WiFi off → cloud summary shows the offline error (no hang)

## (c) Network egress

- [ ] HAR saved as `docs/live-check.har`
- [ ] Zero requests carrying raw PII to googleapis/cloud endpoints
- Verdict:
