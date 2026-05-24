# DivineLink — Architecture

## Tech stack

- Frontend: React 18 + TypeScript
- Build tooling: Vite
- UI: shadcn/ui components + Radix primitives + TailwindCSS
- Routing: react-router (single route `/`, internal navigation handled by `AppLayout`)
- Local database: Dexie.js (IndexedDB)
- Charts: Recharts
- Backups: JSZip + CryptoJS
- E2E tooling present: Playwright (config included; minimal tests)

## Runtime flow

Entry:
- `src/main.tsx` mounts the SPA
- `src/App.tsx` routes `/` to `src/pages/Index.tsx`

Startup actions (see `src/pages/Index.tsx`):
- Initialize local crypto (`src/lib/crypto.ts`)
- Attempt emergency auto-restore (`src/lib/emergencyBackup.ts`)
- Seed default data (`seedDatabase()` in `src/lib/db.ts`)
- Migrate legacy/plaintext patient fields into encrypted form (`src/lib/patientCrypto.ts`)
- Install Dexie hooks to keep emergency snapshots updated

## Storage model

### IndexedDB (primary)

`src/lib/db.ts` defines the Dexie schema and record types, including:
- users
- patients
- appointments
- consultations (includes versioning metadata)
- documents
- auditLogs
- payments
- drugs + drugTransactions
- equipmentItems + equipmentMovements
- templates, generatedDocs, importedDocuments, etc.

### localStorage / sessionStorage (configuration + UX state)

Used for:
- clinic profile (`divinelink.clinic`, `divinelink.clinicId`)
- encryption salt + key check blobs (`dl.enc.*`)
- session payload (in sessionStorage)
- UI state (sidebar collapse, last page, etc)
- sync export markers (`dl.sync.lastExport.v1`)

### Service worker cache

`public/sw.js` caches the app shell and supports offline navigation with `offline.html`.

## Security model (current MVP)

### Authentication

- Users are stored in IndexedDB with a hashed PIN.
- Login validates the PIN against local stored hashes.
- Roles gate certain pages in `src/pages/Index.tsx` and `src/components/AppLayout.tsx`.

### Data-at-rest encryption

Implemented in `src/lib/crypto.ts` + `src/lib/patientCrypto.ts`:
- Key derivation: PBKDF2-SHA256 with per-install random salt
- Stored check blob verifies correct key
- Encryption is field-level (currently focused on a few patient fields)

Important note:
- This protects *data at rest* in IndexedDB and in exported backups.
- It does not protect data while the app is unlocked and running.

## Backup and recovery

### Emergency snapshots (localStorage)

`src/lib/emergencyBackup.ts`:
- Keeps rotating snapshots of key tables in localStorage
- Can auto-restore if IndexedDB appears empty on startup
- Falls back to dropping documents from snapshots if localStorage quota is exceeded

### Operator backups

`src/components/BackupPage.tsx`:
- Encrypted ZIP full backup/restore
- JSON export/import
- Incremental `.divinesync` export/import via `src/lib/sync.ts`

## Sync model (current state)

There is no live multi-device sync.

Supported options today:
- Full restore from encrypted ZIP backup
- Manual file exchange of incremental `.divinesync` bundles (best-effort merge)

“Scheduled sync” (`src/components/ScheduledSyncPage.tsx`) is currently a placeholder and does not implement replication.

## Optional external integrations

Push notifications:
- Client code exists in `src/lib/pushNotifications.ts`.
- It expects a backend (currently structured around Supabase edge functions).
- For on-prem deployments, this must be replaced or disabled.

AI assistant:
- `src/components/AIClinicalAssistant.tsx` is currently stubbed (no external API calls).

