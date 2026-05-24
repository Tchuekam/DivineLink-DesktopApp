/**
 * Emergency auto-backup of critical Dexie tables to localStorage.
 *
 * Survives code updates / IndexedDB wipes. On startup, if IndexedDB is empty
 * but a snapshot exists in localStorage, the data is silently restored.
 *
 * Slots (rotated automatically):
 *   - divinelink-backup-1  (most recent — written on every change)
 *   - divinelink-backup-2  (promoted from slot 1 when slot 1 is > 1 hour old)
 *   - divinelink-backup-3  (promoted from slot 2 when slot 2 is > 24 hours old)
 *
 * Also kept for backward compatibility with the spec key:
 *   - divinelink-emergency-backup  (alias of slot 1)
 */

import { db } from "@/lib/db";
import { toast } from "sonner";

const SLOT1 = "divinelink-backup-1";
const SLOT2 = "divinelink-backup-2";
const SLOT3 = "divinelink-backup-3";
const ALIAS = "divinelink-emergency-backup";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Snapshot {
  ts: number;
  version: 1;
  data: {
    users: any[];
    patients: any[];
    appointments: any[];
    consultations: any[];
    documents: any[];
    auditLogs: any[];
  };
}

function readSlot(key: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

function writeSlot(key: string, snap: Snapshot): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(snap));
    return true;
  } catch (e) {
    // Quota exceeded — try shedding documents (heaviest payload) and retry.
    try {
      const lite = { ...snap, data: { ...snap.data, documents: [] } };
      localStorage.setItem(key, JSON.stringify(lite));
      return true;
    } catch {
      return false;
    }
  }
}

async function buildSnapshot(): Promise<Snapshot> {
  const [users, patients, appointments, consultations, documents, auditLogs] = await Promise.all([
    db.users.toArray(),
    db.patients.toArray(),
    db.appointments.toArray(),
    db.consultations.toArray(),
    db.documents.toArray(),
    db.auditLogs.toArray(),
  ]);
  return {
    ts: Date.now(),
    version: 1,
    data: { users, patients, appointments, consultations, documents, auditLogs },
  };
}

/** Rotate slot1 -> slot2 -> slot3 based on age, then write a fresh slot1. */
async function rotateAndWrite(): Promise<void> {
  const now = Date.now();
  const slot1 = readSlot(SLOT1);
  const slot2 = readSlot(SLOT2);

  // Promote slot2 -> slot3 if slot2 is older than 24h
  if (slot2 && now - slot2.ts >= DAY) {
    writeSlot(SLOT3, slot2);
  }
  // Promote slot1 -> slot2 if slot1 is older than 1h
  if (slot1 && now - slot1.ts >= HOUR) {
    writeSlot(SLOT2, slot1);
  }

  const snap = await buildSnapshot();
  writeSlot(SLOT1, snap);
  // Mirror to spec alias key
  try { localStorage.setItem(ALIAS, JSON.stringify(snap)); } catch {}
}

// Debounced background write — never blocks UI, never throws.
let snapTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSnapshot(): void {
  if (snapTimer) clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    rotateAndWrite().catch(() => {});
  }, 1500);
}

/** Pick the freshest viable snapshot across all slots. */
function pickBestSnapshot(): Snapshot | null {
  const candidates = [readSlot(SLOT1), readSlot(SLOT2), readSlot(SLOT3), readSlot(ALIAS)]
    .filter((s): s is Snapshot => !!s && !!s.data);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.ts - a.ts);
  // Prefer the snapshot with the most patient rows if timestamps are close.
  const top = candidates[0];
  const richer = candidates.find(c => (c.data.patients?.length || 0) > (top.data.patients?.length || 0));
  return richer && richer.data.patients.length > top.data.patients.length * 1.2 ? richer : top;
}

function snapshotIsEmpty(s: Snapshot): boolean {
  const d = s.data;
  return (d.patients?.length || 0) === 0
    && (d.consultations?.length || 0) === 0
    && (d.appointments?.length || 0) === 0
    && (d.documents?.length || 0) === 0;
}

/**
 * Called once at startup. If IndexedDB is empty but a snapshot exists,
 * silently restore everything and toast the user.
 */
export async function autoRestoreIfNeeded(): Promise<boolean> {
  try {
    const [pCount, cCount, aCount, dCount] = await Promise.all([
      db.patients.count(),
      db.consultations.count(),
      db.appointments.count(),
      db.documents.count(),
    ]);
    const idbEmpty = pCount + cCount + aCount + dCount === 0;
    if (!idbEmpty) return false;

    const snap = pickBestSnapshot();
    if (!snap || snapshotIsEmpty(snap)) return false;

    await db.transaction("rw",
      [db.users, db.patients, db.appointments, db.consultations, db.documents, db.auditLogs],
      async () => {
        if (snap.data.users?.length)         await db.users.bulkPut(snap.data.users);
        if (snap.data.patients?.length)      await db.patients.bulkPut(snap.data.patients);
        if (snap.data.appointments?.length)  await db.appointments.bulkPut(snap.data.appointments);
        if (snap.data.consultations?.length) await db.consultations.bulkPut(snap.data.consultations);
        if (snap.data.documents?.length)     await db.documents.bulkPut(snap.data.documents);
        if (snap.data.auditLogs?.length)     await db.auditLogs.bulkPut(snap.data.auditLogs);
      }
    );

    setTimeout(() => {
      toast.success("Données restaurées automatiquement ✓", {
        description: `${snap.data.patients?.length || 0} patients, ${snap.data.consultations?.length || 0} consultations`,
      });
    }, 800);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install Dexie hooks so any patient / consultation / appointment / document
 * write triggers a debounced background snapshot. No UI feedback.
 */
export function installAutoSnapshotHooks(): void {
  const tables = [db.patients, db.consultations, db.appointments, db.documents, db.users] as const;
  for (const t of tables) {
    t.hook("creating", () => { scheduleSnapshot(); });
    t.hook("updating", () => { scheduleSnapshot(); });
    t.hook("deleting", () => { scheduleSnapshot(); });
  }
}

/** Diagnostic helper for the Insights / Backup pages. */
export function getSnapshotInfo() {
  const slots = [
    { key: SLOT1, label: "Slot 1 (latest)", snap: readSlot(SLOT1) },
    { key: SLOT2, label: "Slot 2 (~1h)",    snap: readSlot(SLOT2) },
    { key: SLOT3, label: "Slot 3 (~24h)",   snap: readSlot(SLOT3) },
  ];
  return slots.map(s => ({
    key: s.key,
    label: s.label,
    ts: s.snap?.ts ?? null,
    patients: s.snap?.data.patients?.length ?? 0,
    consultations: s.snap?.data.consultations?.length ?? 0,
    appointments: s.snap?.data.appointments?.length ?? 0,
    documents: s.snap?.data.documents?.length ?? 0,
  }));
}
