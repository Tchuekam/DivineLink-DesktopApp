# DivineLink — Known Issues / Gaps (as of 2026-05-21)

This list focuses on “things to know before selling/deploying” and areas that impact reliability.

## Product gaps vs clinic requests

- No on-prem clinic server: data is stored per-device in IndexedDB.
- No live multi-device sync: “auto-update everywhere” is not implemented.
- iOS/desktop apps are not produced from this repo yet (current build is a web/PWA app).

## Data model / reliability

- Backups/imports:
  - Encrypted ZIP restore is the safest full restore path.
  - JSON import in “merge” mode is intentionally limited (importing related tables without id-mapping can create incorrect links).
- Incremental `.divinesync` merge is best-effort:
  - It remaps patient numeric ids where possible, but user/doctor ids may still not match across devices.

## Security / compliance notes (MVP scope)

- Field-level encryption currently covers only a subset of patient data (phone/address/alerts). Consultations and other tables are not fully encrypted.
- Default PINs (`1234`) must be changed during deployment.
- Remote wipe is URL-token based and depends on safe manual sharing of the wipe URL.

## Optional integrations

- Push notifications require a backend (currently shaped around Supabase). For “no patient data on the internet”, this must be disabled or replaced with a clinic-hosted backend.
- AI assistant is stubbed out (no external API calls).

