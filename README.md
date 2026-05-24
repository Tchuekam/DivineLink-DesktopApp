# DivineLink (Clinic MVP) — Documentation

DivineLink is an offline-first clinic management MVP built as a Vite + React PWA. It runs in a browser (or installed as a PWA), stores data locally in IndexedDB (Dexie), and includes admin tools for users/roles, backups, audit log, and basic security controls.

This repository currently ships a **single-device offline app**. It **does not** yet implement the “all devices auto-update via a local clinic server” requirement; see `docs/ON_PREM_ROADMAP.md`.

## Quick start (local development)

Prerequisites:
- Node.js (recommended: Node 20+)
- npm

Commands:
- Install: `npm install`
- Dev server: `npm run dev` (Vite runs on `http://127.0.0.1:8080/`)
- Build: `npm run build` (outputs to `dist/`)
- Preview build: `npm run preview`
- Tests: `npm test`

## What’s in the app (high level)

Core modules (offline):
- Patients: register/search, export CSV, patient profile, anonymous “code card”
- Appointments (Agenda): daily view, reminders (local notifications), “tasks of the day”, free notes
- Consultations: create and version clinical notes (general + dental-oriented fields)
- Documents: upload/organize patient documents (grid + timeline)
- Diagnosis helper: differential diagnosis by body system (local dataset)
- Payments: per-patient and global payment tracking
- Pharmacy: inventory, stock in/out, transactions, low-stock alerts
- Equipment stock: basic stock counts and movements

Administration:
- User management (roles: `admin`, `doctor`, `receptionist`)
- Security: auto-lock timer, encryption master PIN rotation, remote wipe token, security report
- Backup & restore: encrypted ZIP backup, JSON backup/import, incremental “device sync” files
- Audit log: track key events and export CSV/JSON
- Clinic settings: clinic profile + generated `clinicId`
- Import patients: Excel/CSV import + optional Word/PDF attachment folder
- Scheduled sync: placeholder for future server sync (not production-ready)

## Data storage model (current state)

- Primary storage: **IndexedDB** (Dexie) in the user’s browser profile.
- Some small configuration: **localStorage** and **sessionStorage**.
- Offline caching: **Service Worker** in `public/sw.js`.
- Backups: local export to encrypted ZIP or JSON; optional incremental `.divinesync` change bundles.

## Configuration (optional)

Push notifications integration (optional / not required for offline use):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If unset, the app still works; “push” features should be considered optional.

## Documentation index

- `docs/USER_GUIDE.md`
- `docs/ADMIN_GUIDE.md`
- `docs/ARCHITECTURE.md`
- `docs/ON_PREM_ROADMAP.md`
- `docs/KNOWN_ISSUES.md`

