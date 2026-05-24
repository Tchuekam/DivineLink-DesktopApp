# Plan: Major Feature Additions to DivineLink EMR

This is a large set of features. I'll build them in priority order (Excel import first per user's stated priority), keeping all existing functionality intact. Everything offline-first using Dexie.

## Scope & Priority

Per user: **"La priorité absolue est l'import unique depuis Excel/Word pour démarrer avec la clinique."**

Build order:
1. Excel/CSV patient import (highest priority)
2. Word document import + viewer + conversion assistant
3. Observation templates (admin builder + consultation usage)
4. Dental odontogram tab (note: a basic `DentalExamPage` already exists — extend/integrate it into the consultation flow)
5. Scheduled sync job (lowest priority, offline-only stub)

## 1. Database changes (`src/lib/db.ts`)

Add to Dexie schema (bump version):
- `patients` table: add `externalId?: string` (indexed, unique-ish)
- `consultations` table: add `templateId?: number`, `customFields?: Record<string, any>`, `dentalExam?: any` (already has `dental` — reuse where possible)
- New table `consultationTemplates`: `id, name, specialty, fieldsDefinition (JSON array of field defs), active, createdAt, updatedAt`
- New table `importedDocuments`: `id, patientId, filename, mimeType, blob (Blob), uploadedAt, source ('import'|'manual'), convertedConsultationId?`

Field definition shape:
```ts
type TemplateField =
  | { id: string; type: 'short_text'|'long_text'|'checkbox'|'select'; label: string; required?: boolean; options?: string[] }
  | { id: string; type: 'vitals'; label: string }
  | { id: string; type: 'anthropometric'; label: string };
```

## 2. New components

- `src/components/ImportPatientsPage.tsx` — file upload (xlsx/csv), preview table, duplicate handling UI (ignore/update/create-new per row), commit. Uses `xlsx` npm package (SheetJS).
- `src/components/ImportedDocumentsTab.tsx` — list of Word docs for a patient, download/view/convert actions. Embed in `PatientProfile`.
- `src/components/WordConversionAssistant.tsx` — modal: extracts text via `mammoth`, runs heuristic section splitter (plainte/antécédents/examen/traitement keywords FR+EN), pre-fills consultation form using active template, user validates and saves.
- `src/components/ObservationTemplatesPage.tsx` — admin list + CRUD.
- `src/components/TemplateBuilder.tsx` — palette + dropzone editor (mobile-friendly), add/remove/reorder fields, save.
- `src/components/TemplateRenderer.tsx` — given a template + values, renders the form. Used inside consultation creation.
- `src/components/ScheduledSyncPage.tsx` — admin UI to configure folder/endpoint and run sync manually (offline-safe stub; real cron requires network).

## 3. Integration points

- `AppLayout.tsx` — add admin menu entries: "Modèles d'observation", "Importer des patients", "Synchronisation planifiée".
- `ConsultationsPage.tsx` — when creating consultation, show template selector (filtered by patient's expected specialty); render `TemplateRenderer`; save into `customFields` + `templateId`.
- `PatientProfile.tsx` — add "Documents importés" tab.
- `DentalExamPage.tsx` — already exists. Make it accessible as a tab inside consultation flow when consultType=dental (already wired). No big change needed beyond ensuring odontogram + mobility/pocket depth fields persist into `dentalExam`.
- `i18n.ts` — add FR/EN strings for all new labels.

## 4. Dependencies

- `xlsx` (SheetJS) — Excel/CSV parsing
- `mammoth` — .docx text extraction
- `@dnd-kit/core` + `@dnd-kit/sortable` — already may be present; if not, add for the template builder

## 5. Out of scope / stubs

- Email reports from scheduled sync: stubbed (toast only) since the app is offline-only. Document in UI.
- Real cron scheduling: use `setInterval` while app is open, plus manual trigger button. True background sync would need a service worker periodic-sync API (limited browser support); add a TODO note.
- Google Docs Viewer for Word preview requires network — fall back to mammoth-rendered HTML preview offline.

## Technical notes

- Existing `Patient` type lives in `db.ts`; `decryptPatients` in `patientCrypto.ts` handles encryption. New imports go through the same encryption pipeline so PHI stays encrypted at rest.
- `importedDocuments.blob` stored as `Blob` directly in IndexedDB (Dexie supports this). Consider encrypting blobs with the same master key — will reuse `crypto.ts` helpers.
- Audit log entries for: template create/edit/delete, patient import (count), document import, conversion to consultation.

## Estimated file footprint

~10 new files, ~6 edited files. No removals.
