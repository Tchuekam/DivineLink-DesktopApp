/**
 * Data Access Layer.
 *
 * Thin facade over Dexie tables so components don't import `db` directly.
 * Future-proofs swapping the storage backend (e.g. cloud sync) without
 * changing call sites. Same shape as Dexie tables, plus a few helpers.
 */
import { db } from "@/lib/db";
import type {
  User, Patient, Appointment, Consultation, Document, AuditLog,
  Drug, DrugTransaction, GeneratedDoc,
} from "@/lib/db";
import { getClinicId } from "@/lib/clinicSettings";

export const dal = {
  users: db.users,
  patients: db.patients,
  appointments: db.appointments,
  consultations: db.consultations,
  documents: db.documents,
  auditLogs: db.auditLogs,
  drugs: db.drugs,
  drugTransactions: db.drugTransactions,
  generatedDocs: db.generatedDocs,

  /** Stamp the current clinicId onto a record before insert. */
  stamp<T extends { clinicId?: string }>(rec: T): T {
    if (!rec.clinicId) rec.clinicId = getClinicId();
    return rec;
  },

  /** Tables filtered by current clinicId (single-clinic deploys still get all rows). */
  forClinic: {
    patients: () => db.patients.toArray().then(filterByClinic),
    consultations: () => db.consultations.toArray().then(filterByClinic),
    appointments: () => db.appointments.toArray().then(filterByClinic),
    documents: () => db.documents.toArray().then(filterByClinic),
    drugs: () => db.drugs.toArray().then(filterByClinic),
    drugTransactions: () => db.drugTransactions.toArray().then(filterByClinic),
  },
};

function filterByClinic<T extends { clinicId?: string }>(rows: T[]): T[] {
  const id = getClinicId();
  if (!id) return rows;
  return rows.filter((r) => !r.clinicId || r.clinicId === id);
}

export type {
  User, Patient, Appointment, Consultation, Document, AuditLog,
  Drug, DrugTransaction, GeneratedDoc,
};
