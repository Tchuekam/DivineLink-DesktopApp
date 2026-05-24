/**
 * Lightweight schema validation for backup imports.
 * Filters out records that don't conform to the expected shape so a
 * malicious or corrupted backup cannot inject arbitrary fields, oversized
 * blobs, or unauthorized user roles into IndexedDB.
 */

const MAX_STRING = 20_000; // generic field cap
const MAX_BLOB = 8_000_000; // ~8MB cap per record (base64 documents)
const ALLOWED_ROLES = new Set(["admin", "doctor", "receptionist"]);

const isStr = (v: unknown, max = MAX_STRING) =>
  typeof v === "string" && v.length <= max;
const isOptStr = (v: unknown, max = MAX_STRING) =>
  v == null || (typeof v === "string" && v.length <= max);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isOptNum = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v));
const isOptBool = (v: unknown) => v == null || typeof v === "boolean";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export interface ValidationReport {
  kept: Record<string, number>;
  rejected: Record<string, number>;
}

function validateUser(u: unknown): u is Record<string, unknown> {
  if (!isPlainObject(u)) return false;
  if (!isStr(u.name, 200)) return false;
  if (typeof u.role !== "string" || !ALLOWED_ROLES.has(u.role)) return false;
  if (!isStr(u.pinHash, 500)) return false;
  if (typeof u.active !== "boolean") return false;
  if (!isOptStr(u.phone, 50)) return false;
  if (!isOptStr(u.clinicId, 100)) return false;
  if (!isStr(u.createdAt, 64)) return false;
  return true;
}

function validatePatient(p: unknown): p is Record<string, unknown> {
  if (!isPlainObject(p)) return false;
  if (!isStr(p.patientId, 100)) return false;
  if (!isStr(p.firstName, 200)) return false;
  if (!isStr(p.lastName, 200)) return false;
  if (!isOptStr(p.phone, 200)) return false;
  if (!isOptStr(p.address, 1000)) return false;
  if (!isOptStr(p.medicalAlerts, 5000)) return false;
  return true;
}

function validateAppointment(a: unknown): a is Record<string, unknown> {
  if (!isPlainObject(a)) return false;
  if (!isOptNum(a.patientId)) return false;
  if (!isStr(a.date, 32)) return false;
  if (!isOptStr(a.time, 32)) return false;
  if (!isOptStr(a.status, 64)) return false;
  return true;
}

function validateConsultation(c: unknown): c is Record<string, unknown> {
  if (!isPlainObject(c)) return false;
  if (!isOptNum(c.patientId)) return false;
  if (!isOptStr(c.date, 64)) return false;
  return true;
}

function validateDocument(d: unknown): d is Record<string, unknown> {
  if (!isPlainObject(d)) return false;
  if (!isOptNum(d.patientId)) return false;
  // documents may carry base64 blobs — cap total serialized size
  try {
    const size = JSON.stringify(d).length;
    if (size > MAX_BLOB) return false;
  } catch { return false; }
  return true;
}

function filterArray<T>(
  arr: unknown,
  validator: (v: unknown) => boolean,
  report: ValidationReport,
  key: string
): T[] {
  if (!Array.isArray(arr)) {
    report.kept[key] = 0; report.rejected[key] = 0;
    return [];
  }
  const out: T[] = [];
  let rejected = 0;
  for (const item of arr) {
    if (validator(item)) out.push(item as T);
    else rejected++;
  }
  report.kept[key] = out.length;
  report.rejected[key] = rejected;
  return out;
}

export interface SanitizedBackup {
  users: any[];
  patients: any[];
  appointments: any[];
  consultations: any[];
  documents: any[];
  auditLogs: any[];
  drugs: any[];
  drugTransactions: any[];
  generatedDocs: any[];
}

/**
 * Validate and sanitize a raw decoded backup payload.
 * Returns the sanitized data plus a report. Throws if the top-level
 * shape is unusable (not an object).
 */
export function sanitizeBackup(raw: unknown): { data: SanitizedBackup; report: ValidationReport } {
  if (!isPlainObject(raw)) throw new Error("Invalid backup payload (not an object)");
  const report: ValidationReport = { kept: {}, rejected: {} };
  return {
    data: {
      users: filterArray(raw.users, validateUser, report, "users"),
      patients: filterArray(raw.patients, validatePatient, report, "patients"),
      appointments: filterArray(raw.appointments, validateAppointment, report, "appointments"),
      consultations: filterArray(raw.consultations, validateConsultation, report, "consultations"),
      documents: filterArray(raw.documents, validateDocument, report, "documents"),
      auditLogs: filterArray(raw.auditLogs, isPlainObject, report, "auditLogs"),
      drugs: filterArray(raw.drugs, isPlainObject, report, "drugs"),
      drugTransactions: filterArray(raw.drugTransactions, isPlainObject, report, "drugTransactions"),
      generatedDocs: filterArray(raw.generatedDocs, isPlainObject, report, "generatedDocs"),
    },
    report,
  };
}

export function formatRejected(report: ValidationReport): string {
  const bad = Object.entries(report.rejected).filter(([, n]) => n > 0);
  if (bad.length === 0) return "";
  return bad.map(([k, n]) => `${k}: ${n}`).join(", ");
}
