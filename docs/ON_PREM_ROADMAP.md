# DivineLink — On‑Prem + Desktop Roadmap (to meet clinic requirements)

Clinics have requested:
1) iOS + desktop clients
2) patient data stored on the clinic’s **local server** (not on the public internet)
3) “auto-update everywhere” (multi-device live sync)

The current repo is an **offline single-device PWA** that stores data in browser IndexedDB. To meet the above, the architecture must evolve.

## Target architecture (recommended)

### Components

- **Clinic local server (on-prem)**:
  - Runs on a machine inside the clinic network (Windows/Linux mini-PC/NAS).
  - Hosts the primary database and an authenticated API.
  - Provides backup/export for compliance.

- **Clients**:
  - Desktop app (Windows/macOS/Linux) for doctors/admin staff.
  - iOS app for doctors/receptionists (and optionally patient-facing “view” mode).
  - Optional web/PWA client for rapid deployment (still talking only to the on-prem server).

### Data + sync principles

- Source of truth moves from per-device IndexedDB to the clinic server database.
- Clients keep a local cache for offline work (optional), then sync when back on LAN/VPN.
- Every record needs:
  - stable identifiers (UUIDs, not auto-increment integers)
  - `updatedAt` timestamps and/or per-field conflict strategy
  - audit events and user attribution

## Desktop packaging options (for this codebase)

### Option A: Desktop wrapper around the existing web app

Use Electron or Tauri to:
- ship the current React UI as a desktop app
- talk to a clinic-local server over HTTP(S)
- optionally keep a local cache (SQLite) for offline mode

Pros:
- fastest path to “desktop version”
- reuses most UI code

Cons:
- still needs a real on-prem backend + sync logic

### Option B: Keep PWA for desktop + add local server

Install the PWA in Chrome/Edge on desktops.
Pros:
- minimal packaging work
Cons:
- harder control over updates/device management
- still needs on-prem backend + sync

## On-prem backend (recommended baseline)

Minimum features:
- Authentication (users/roles), with clinic-local credentials
- CRUD APIs for:
  - patients, appointments, consultations, documents, payments, pharmacy, equipment
- Audit log as a first-class server table
- Backup/export + restore
- Multi-device sync:
  - simplest: client always reads/writes directly to server
  - advanced: client offline cache + conflict resolution

Implementation choices:
- Database: PostgreSQL (preferred) or SQLite (single-server, lower admin burden)
- Server: Node.js (Fastify/NestJS/Express) or .NET or Rust
- Transport: REST + SSE/WebSocket for “live updates”
- File storage: on server disk with encryption-at-rest and access control

## Migration from current MVP

Key gaps to address:
- Current data uses IndexedDB numeric ids. These should become server UUIDs.
- Current “device sync” is file-based and best-effort; it is not a replacement for live sync.
- Current field-level encryption is device-local; on a server, encryption/key management must be designed explicitly.

Suggested migration plan:
1. Implement server schema + API endpoints for patients/appointments/consultations/documents/users.
2. Replace Dexie DAL calls with an API-backed DAL (keep the component surfaces stable).
3. Add real-time updates (WebSocket/SSE) for “auto-update everywhere”.
4. Add offline caching on clients if required.
5. Package desktop app (Tauri/Electron) once the API contract is stable.
6. Build iOS client (native or React Native) against the same API.

