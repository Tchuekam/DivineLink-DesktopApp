/**
 * Manual offline sync via .divinesync files.
 * - Export: collect all records modified since the last successful export,
 *   bundle as JSON, encrypt with the master PIN (AES via CryptoJS), download.
 * - Import: decrypt, merge each record with last-modified-wins.
 *
 * No network calls. Files are exchanged manually (WhatsApp / USB / email).
 */
import CryptoJS from "crypto-js";
import { db, type Patient, type Consultation, type Appointment, type Document, type User } from "@/lib/db";
import { decryptPatients, encryptPatientForSave } from "@/lib/patientCrypto";

const LAST_SYNC_KEY = "dl.sync.lastExport.v1";
export const SYNC_EXTENSION = ".divinesync";

export interface SyncBundle {
  version: 1;
  generatedAt: string;
  since: string | null;
  counts: { patients: number; consultations: number; appointments: number; documents: number; users: number };
  data: {
    patients: Patient[];
    consultations: Consultation[];
    appointments: Appointment[];
    documents: Document[];
    users: User[];
  };
}

export function getLastSyncTime(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

export function setLastSyncTime(iso: string): void {
  localStorage.setItem(LAST_SYNC_KEY, iso);
}

function modifiedSince(rec: { updatedAt?: string; createdAt?: string; date?: string; editedAt?: string }, since: string | null): boolean {
  if (!since) return true;
  const t = rec.updatedAt || rec.editedAt || rec.createdAt || rec.date;
  if (!t) return true;
  return t > since;
}

/** Build an unencrypted sync bundle of records changed since the last export. */
export async function buildSyncBundle(): Promise<SyncBundle> {
  const since = getLastSyncTime();
  const patientsRaw = await decryptPatients(await db.patients.toArray());
  const patients = patientsRaw.filter(p => modifiedSince(p, since));
  const consultations = (await db.consultations.toArray()).filter(c => modifiedSince(c, since));
  const appointments = (await db.appointments.toArray()).filter(a => modifiedSince(a, since));
  const documents = (await db.documents.toArray()).filter(d => modifiedSince(d, since));
  const users = (await db.users.toArray()).filter(u => modifiedSince(u, since));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    since,
    counts: {
      patients: patients.length,
      consultations: consultations.length,
      appointments: appointments.length,
      documents: documents.length,
      users: users.length,
    },
    data: { patients, consultations, appointments, documents, users },
  };
}

/** Encrypt a sync bundle with the master PIN (or any passphrase). */
export function encryptSyncBundle(bundle: SyncBundle, passphrase: string): string {
  const json = JSON.stringify(bundle);
  return CryptoJS.AES.encrypt(json, passphrase).toString();
}

/** Decrypt a .divinesync file content. Throws on wrong passphrase or bad format. */
export function decryptSyncBundle(cipher: string, passphrase: string): SyncBundle {
  const bytes = CryptoJS.AES.decrypt(cipher, passphrase);
  const json = bytes.toString(CryptoJS.enc.Utf8);
  if (!json) throw new Error("invalid passphrase");
  const parsed = JSON.parse(json);
  if (!parsed || parsed.version !== 1 || !parsed.data) throw new Error("invalid bundle");
  return parsed as SyncBundle;
}

export interface MergeReport {
  patients: { added: number; updated: number };
  consultations: { added: number; updated: number };
  appointments: { added: number; updated: number };
  documents: { added: number; updated: number };
  users: { added: number; updated: number };
  skipped: { appointments: number; consultations: number; documents: number };
}

function recTime(r: any): number {
  return new Date(r.updatedAt || r.editedAt || r.createdAt || r.date || 0).getTime();
}

/** Merge a decrypted sync bundle into local IndexedDB. Last-modified wins. */
export async function mergeSyncBundle(bundle: SyncBundle): Promise<MergeReport> {
  const report: MergeReport = {
    patients: { added: 0, updated: 0 },
    consultations: { added: 0, updated: 0 },
    appointments: { added: 0, updated: 0 },
    documents: { added: 0, updated: 0 },
    users: { added: 0, updated: 0 },
    skipped: { appointments: 0, consultations: 0, documents: 0 },
  };

  // Remap numeric patient ids across devices. Patient rows are matched by the
  // stable string `patientId`, but related tables store `patientId` as a number.
  // Without remapping, appointments/consultations/documents could attach to the
  // wrong patient after import.
  const patientIdRemap = new Map<number, number>();

  // Patients (match by patientId, not numeric id, to survive cross-device id drift)
  for (const incoming of bundle.data.patients) {
    const existing = incoming.patientId
      ? await db.patients.where("patientId").equals(incoming.patientId).first()
      : null;
    const encrypted = await encryptPatientForSave({ ...incoming, id: undefined as any });
    if (!existing) {
      const newId = await db.patients.add({ ...(encrypted as Patient), id: undefined as any });
      report.patients.added++;
      if (typeof incoming.id === "number" && typeof newId === "number") patientIdRemap.set(incoming.id, newId);
    } else if (recTime(incoming) > recTime(existing)) {
      await db.patients.update(existing.id!, { ...(encrypted as Patient), id: undefined as any });
      report.patients.updated++;
      if (typeof incoming.id === "number") patientIdRemap.set(incoming.id, existing.id!);
    } else {
      if (typeof incoming.id === "number") patientIdRemap.set(incoming.id, existing.id!);
    }
  }

  // Consultations: match by originalId+versionNumber when possible, else add
  for (const incoming of bundle.data.consultations) {
    // Remap to local numeric patient id (skip if not resolvable)
    const mappedPid = typeof incoming.patientId === "number" ? patientIdRemap.get(incoming.patientId) : undefined;
    if (typeof incoming.patientId === "number" && mappedPid == null) { report.skipped.consultations++; continue; }
    let existing: Consultation | undefined;
    if (incoming.originalId && incoming.versionNumber) {
      existing = await db.consultations
        .where("originalId").equals(incoming.originalId)
        .and(c => c.versionNumber === incoming.versionNumber)
        .first();
    }
    if (!existing) {
      await db.consultations.add({ ...incoming, patientId: mappedPid ?? incoming.patientId, id: undefined as any });
      report.consultations.added++;
    } else if (recTime(incoming) > recTime(existing)) {
      await db.consultations.update(existing.id!, { ...incoming, patientId: mappedPid ?? incoming.patientId, id: undefined as any });
      report.consultations.updated++;
    }
  }

  // Appointments: match by patient+date+time
  for (const incoming of bundle.data.appointments) {
    const mappedPid = typeof incoming.patientId === "number" ? patientIdRemap.get(incoming.patientId) : undefined;
    if (typeof incoming.patientId === "number" && mappedPid == null) { report.skipped.appointments++; continue; }
    const existing = await db.appointments
      .where("patientId").equals((mappedPid ?? incoming.patientId) as any)
      .and(a => a.date === incoming.date && a.time === incoming.time)
      .first();
    if (!existing) {
      await db.appointments.add({ ...incoming, patientId: mappedPid ?? incoming.patientId, id: undefined as any });
      report.appointments.added++;
    } else if (recTime(incoming) > recTime(existing)) {
      await db.appointments.update(existing.id!, { ...incoming, patientId: mappedPid ?? incoming.patientId, id: undefined as any });
      report.appointments.updated++;
    }
  }

  // Documents: match by patient+name+createdAt
  for (const incoming of bundle.data.documents) {
    const mappedPid = typeof incoming.patientId === "number" ? patientIdRemap.get(incoming.patientId) : undefined;
    if (typeof incoming.patientId === "number" && mappedPid == null) { report.skipped.documents++; continue; }
    const existing = await db.documents
      .where("patientId").equals((mappedPid ?? incoming.patientId) as any)
      .and(d => d.name === incoming.name && d.createdAt === incoming.createdAt)
      .first();
    if (!existing) {
      await db.documents.add({ ...incoming, patientId: mappedPid ?? incoming.patientId, id: undefined as any });
      report.documents.added++;
    }
  }

  // Users: match by name+role
  for (const incoming of bundle.data.users) {
    const existing = await db.users
      .where("name").equals(incoming.name)
      .and(u => u.role === incoming.role)
      .first();
    if (!existing) {
      await db.users.add({ ...incoming, id: undefined as any });
      report.users.added++;
    } else if (recTime(incoming) > recTime(existing)) {
      await db.users.update(existing.id!, { ...incoming, id: undefined as any });
      report.users.updated++;
    }
  }

  return report;
}
