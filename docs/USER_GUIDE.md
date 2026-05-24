# DivineLink — User Guide

This guide describes how clinic staff use the current MVP (offline-first single-device app).

## Login

- Open the app and enter your PIN.
- Default first-run account:
  - User: `Admin`
  - Role: `admin`
  - PIN: `1234`

After first login:
- Ask your admin to create your user and PIN in **Administration → User management**.
- The admin should change the default PINs as part of deployment.

## Navigation basics

DivineLink is a single-page app with a sidebar:
- Main modules (all roles): Dashboard, Patients, Appointments, Consultations, Diagnosis, Documents, Statistics, Dental exam.
- Administration modules (admin-only): payments, users, backup, security, audit log, clinic settings, pharmacy, equipment, templates, import, scheduled sync.

There is a **global search** box in the top bar. It’s intended for quickly searching patients/notes/documents (implementation varies by module).

## Patients

From **Patients** you can:
- Search patients by name/phone/patient ID.
- Register a new patient (minimal form).
- Export all patients to CSV.
- Open a patient profile for details and history.

Patient identifiers:
- `patientId` (example: `PAT-0001`) — internal stable patient record code.
- `anonCode` (example: `DL-2026-ABCD-123`) — shareable anonymous code (“code card”) intended for referrals without directly identifying the patient.

## Appointments (Agenda)

The **Appointments / Rendez-vous** module provides:
- A daily agenda view by date.
- Creating and updating appointments with status changes.
- Tabs for “Tasks of the day” and “Free notes”.

Notifications:
- The app can show local OS notifications (if permission is granted).
- “Push” notifications (server-driven) are optional and should be considered experimental unless a clinic-hosted backend exists.

## Consultations

The **Consultations** module is used to record clinical visits:
- Create a new consultation for a patient.
- Edit consultations with a built-in versioning approach (keeps prior versions).
- Capture vitals and structured sections (varies by template/type).

## Documents

The **Documents** module supports:
- Uploading patient files (images/PDF/etc).
- Tagging and filtering.
- Viewing in a grid or timeline mode.

Note: documents are stored locally (IndexedDB) and contribute heavily to storage usage.

## Diagnosis helper

The **Diagnosis** module is a local “differential diagnosis” helper:
- Choose a body system category.
- Browse common conditions.
- Use it as a reference during triage/consultation notes.

It does not replace clinical judgment.

## Statistics / Research

The **Statistics** module includes dashboards and report builders such as:
- Counts of patients/consultations/appointments.
- Custom report generation (period/grouping/chart type).
- Specialized tabs (demographics, dentistry, research export).

## Dental exam

The **Dental exam** module includes:
- Dental charting (adult/pediatric views)
- Periodontal fields
- Motive & pain section
- Diagnosis & plan section

This module is useful for dental/orthodontic workflows but can be ignored in general clinics.

