# DivineLink — Admin Guide (Offline MVP)

This guide is for clinic admins deploying and operating the current offline-first MVP.

## First-time setup checklist (recommended)

1. Login with the default admin account (PIN `1234`).
2. Complete **Clinic onboarding** (clinic name, location, currency, etc).
3. Create staff accounts (doctor/receptionist) in **Administration → User management**.
4. Change default PINs:
   - Change the Admin user PIN (User management).
   - Change the **encryption master PIN** (Administration → Security).
5. Configure auto-lock timeout (Administration → Security).
6. Do a first encrypted backup (Administration → Backup & restore).

## Users & roles

Roles are stored locally:
- `admin`: full access (including backups, security, audit log, user management, import)
- `doctor`: clinical modules
- `receptionist`: patient registration + scheduling (exact access depends on UI checks)

User PINs:
- Stored as salted hashes in IndexedDB.
- The app uses a PIN-first login flow. (The “username” field on the login screen is cosmetic in the current MVP.)

## Clinic settings

Administration → Clinic settings stores the clinic profile in localStorage:
- name, address, phone, email, doctor name, license number, opening hours, currency
- `clinicId` is generated once and used to stamp records

## Security controls

Administration → Security includes:
- **Auto-lock timeout** (forces re-login after inactivity)
- **Encryption master PIN rotation**
  - Re-derives the local encryption key and re-encrypts sensitive patient fields on this device.
  - Default value is `1234` until changed.
- **Remote wipe token**
  - Generates a local secret and a URL parameter `?wipe=...`.
  - If a device opens the wipe URL and the secret matches its locally stored secret, the app erases local storage (IndexedDB + localStorage + caches + service workers).
  - No server is involved; sharing the URL is manual (SMS/WhatsApp/etc).
- **Security report** (bilingual overview of the current design)

### What is encrypted (current MVP)

Field-level encryption is applied to selected patient fields:
- phone
- address
- medical alerts

Other entities (consultations, documents metadata, audit log, etc.) are not fully encrypted in the current MVP.

## Backup & restore

Administration → Backup & restore provides multiple mechanisms:

### 1) Encrypted ZIP backup (recommended for full restore)

- Export creates a ZIP containing an AES-encrypted JSON payload.
- Import clears local tables and restores the backup.
- This mode preserves record ids and is the safest “full restore” path.

Operational guidance:
- Keep the password in a clinic password manager.
- Store backup files off-device (external drive + secure location).

### 2) JSON backup / import (use with care)

- JSON export writes a human-readable backup file.
- JSON import supports “replace” and “patients-only” flows.
- “Merge” is intentionally limited to avoid incorrect linking between tables.

### 3) Incremental “device sync” bundles (`.divinesync`)

- Export generates an encrypted bundle of changes since last export.
- Import merges changes with “last-modified wins” behavior.

Notes:
- This is an offline file-exchange workflow (USB/WhatsApp/email).
- It is not real-time sync and is not equivalent to a shared clinic server.

## Audit log

Administration → Audit log records key events:
- logins, login failures, logouts
- create/update/delete operations (varies by module)
- exports/imports (backup/sync)

Exports:
- CSV
- JSON

## Import patients (Excel/CSV)

Administration → Import patients supports importing patient lists, with optional attachments:
- Expected columns: `external_id, first_name, last_name, phone, dob, address, word_filename`
- Optional: provide a folder of Word/PDF files to associate documents during import

## Scheduled sync (placeholder)

Administration → Scheduled sync currently only polls a configured endpoint while the app is open.
It is not a production-ready “local server replication” feature.

