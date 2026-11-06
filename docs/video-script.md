# PrivRedact demo video script (≤3 min)

Voice: edge-tts `en-US-GuyNeural` via the ai-shorts-kit free path
(`production/gen_vo_edge.py` pattern → `vo.mp3` + `align.json`), muxed with
`ffmpeg -f x11grab` screen capture. Target ~380 words + live demo pauses.

## Beat 1 — Hook (0:00–0:25)

ON SCREEN: invoice photo → tap Redact → PII black-barred instantly, ON_DEVICE badge.
VO: "Every photo of a receipt you upload to the cloud leaks your name, email,
and phone number. PrivRedact fixes that. Watch: I snap an invoice, and the
private parts are blacked out on my own device, before anything touches the
network. See the badge? On device."

## Beat 2 — Offline proof (0:25–1:00)

ON SCREEN: WiFi off → redact again (works, ON_DEVICE) → summary shows the
offline error → ONLY_IN_CLOUD mode fails honestly.
VO: "No connection? No problem. The redaction still works, because the small
model lives in the browser. The cloud summary waits politely instead of
hanging. And if I force cloud-only with no network, it says so — every answer
carries its true badge."

## Beat 3 — Cloud value (1:00–1:40)

ON SCREEN: WiFi on → redacted text (never the raw photo) → structured JSON
summary: vendor, total, date, actions.
VO: "Back online, only the redacted text — never your raw photo — goes to the
big model, which returns a clean structured summary: vendor, total, date, next
actions. Private by construction, powerful by fallback."

## Beat 4 — Dashboard (1:40–2:15)

ON SCREEN: routing dashboard rows (mode, source, latency, fallback) → flip
PREFER_ON_DEVICE / PREFER_IN_CLOUD → badges follow the real route.
VO: "The dashboard proves the hybrid story: every request shows its mode,
where it actually ran, and how long it took. Flip the mode, and the badges
follow the real route — never a guess."

## Beat 5 — Close (2:15–2:50)

ON SCREEN: "raw PII never left this device" + cost line ($0 on-device) + live URL.
VO: "Raw PII never left this device. On-device answers cost zero cents and
zero latency to the cloud. Try it live at the link below — built with Firebase
AI Logic hybrid inference for Build Hybrid AI 2026."
