import { db, type Patient } from "@/lib/db";
import { encryptString, decryptString } from "@/lib/crypto";

const SENSITIVE: (keyof Patient)[] = ["phone", "address", "medicalAlerts"];

export async function decryptPatient(p: Patient): Promise<Patient> {
  const out: Patient = { ...p };
  for (const k of SENSITIVE) {
    const v = (out as any)[k];
    if (typeof v === "string" && v) (out as any)[k] = await decryptString(v);
  }
  return out;
}

export async function decryptPatients(list: Patient[]): Promise<Patient[]> {
  if (list.length === 0) return [];
  const results: Patient[] = new Array(list.length);
  const promises: Promise<void>[] = [];

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const out: Patient = { ...p };
    results[i] = out;
    for (const k of SENSITIVE) {
      const v = (out as any)[k];
      if (typeof v === "string" && v) {
        promises.push(
          decryptString(v).then(decrypted => { (out as any)[k] = decrypted; })
        );
      }
    }
  }

  await Promise.all(promises);
  return results;
}

export async function encryptPatientForSave<T extends Partial<Patient>>(p: T): Promise<T> {
  const out: T = { ...p };
  for (const k of SENSITIVE) {
    const v = (out as any)[k];
    if (typeof v === "string" && v) (out as any)[k] = await encryptString(v);
  }
  return out;
}

/** Decrypt phone for matching against a search query. */
export async function patientMatchesQuery(p: Patient, query: string): Promise<boolean> {
  const dp = await decryptPatient(p);
  const q = query.toLowerCase();
  return (
    dp.firstName.toLowerCase().includes(q) ||
    dp.lastName.toLowerCase().includes(q) ||
    (dp.phone || "").toLowerCase().includes(q) ||
    dp.patientId.toLowerCase().includes(q)
  );
}

/** Migrate any legacy plaintext rows in IndexedDB to ciphertext. Idempotent. */
export async function migrateEncryption(): Promise<void> {
  const all = await db.patients.toArray();
  for (const p of all) {
    const updates: Partial<Patient> = {};
    let changed = false;
    for (const k of SENSITIVE) {
      const v = (p as any)[k];
      if (typeof v === "string" && v && !v.startsWith("enc:v1:")) {
        (updates as any)[k] = await encryptString(v);
        changed = true;
      }
    }
    if (changed && p.id) await db.patients.update(p.id, updates);
  }
}
