/**
 * Smart notifications system for DivineLink.
 *
 * Fully offline: uses the window.Notification API, localStorage for
 * deduplication (one notification per key per day), and Dexie for
 * data queries. Never shows the same notification twice on the same day.
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function hasNotifiedToday(key: string): boolean {
  try {
    return localStorage.getItem(key) === todayStr();
  } catch {
    return false;
  }
}

function markNotified(key: string): void {
  try {
    localStorage.setItem(key, todayStr());
  } catch {
    // localStorage unavailable – best effort
  }
}

function showNotification(title: string, body: string, tag: string): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "/placeholder.svg", tag });
}

// ---------------------------------------------------------------------------
// Interval tracking
// ---------------------------------------------------------------------------

const intervalIds: ReturnType<typeof setInterval>[] = [];

function registerInterval(fn: () => void, ms: number): void {
  intervalIds.push(setInterval(fn, ms));
}

// ---------------------------------------------------------------------------
// requestNotificationPermission
// ---------------------------------------------------------------------------

const PERM_KEY = "dl.notif.permission.v1";

export function requestNotificationPermission(): void {
  if (!("Notification" in window)) return;

  const stored = localStorage.getItem(PERM_KEY);
  if (stored === "granted" || stored === "denied") return; // already decided

  if (Notification.permission === "default") {
    Notification.requestPermission().then((result) => {
      try {
        localStorage.setItem(PERM_KEY, result);
      } catch {
        // ignore
      }
    });
  } else {
    try {
      localStorage.setItem(PERM_KEY, Notification.permission);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// initSmartNotifications
// ---------------------------------------------------------------------------

export function initSmartNotifications(userName: string): void {
  // 1. Daily 7:30am greeting -----------------------------------------------
  registerInterval(async () => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    if (h !== 7 || m < 25 || m > 35) return;

    const dateKey = `dl.notif.morning.${todayStr()}`;
    if (hasNotifiedToday(dateKey)) return;

    try {
      const today = todayStr();
      const count = await db.appointments
        .where("date")
        .equals(today)
        .count();

      const body = `Bonjour Dr ${userName}. ${count} rendez-vous aujourd'hui`;
      showNotification("DivineLink", body, `morning-${today}`);
      markNotified(dateKey);
    } catch {
      // DB query failed – skip this cycle
    }
  }, 60_000);

  // 2. 8pm backup reminder --------------------------------------------------
  registerInterval(() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    if (h !== 20 || m > 10) return;

    const dateKey = `dl.notif.backup.${todayStr()}`;
    if (hasNotifiedToday(dateKey)) return;

    // Check last backup time
    let lastExport: string | null = null;
    try {
      lastExport = localStorage.getItem("dl.sync.lastExport.v1");
    } catch {
      // ignore
    }

    if (lastExport) {
      const lastDate = new Date(lastExport);
      const diffDays = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays < 3) return; // backed up recently enough
    }
    // No backup at all, or 3+ days ago

    const body = "Pensez \u00e0 sauvegarder DivineLink";
    showNotification("DivineLink", body, `backup-${todayStr()}`);
    markNotified(dateKey);
  }, 60_000);

  // 3. 30min before appointment --------------------------------------------
  registerInterval(async () => {
    const now = new Date();
    const todayISO = todayStr();

    try {
      const appointments = await db.appointments
        .where("date")
        .equals(todayISO)
        .toArray();

      for (const appt of appointments) {
        if (!appt.id || !appt.time) continue;
        if (appt.status === "cancelled" || appt.status === "completed") continue;

        // Build appointment datetime
        const [hours, minutes] = appt.time.split(":").map(Number);
        if (isNaN(hours) || isNaN(minutes)) continue;

        const apptDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        const diffMs = apptDate.getTime() - now.getTime();
        const diffMin = diffMs / 60_000;

        // Within 30-31 minutes from now
        if (diffMin < 30 || diffMin >= 31) continue;

        const dateKey = `dl.notif.appt.${appt.id}.${todayISO}`;
        if (hasNotifiedToday(dateKey)) continue;

        // Get patient name
        let patientName = "Patient";
        if (appt.patientId) {
          try {
            const patient = await db.patients.get(appt.patientId);
            if (patient) patientName = `${patient.firstName} ${patient.lastName}`;
          } catch {
            // fallback to default
          }
        }

        const body = `Rendez-vous dans 30min : ${patientName}`;
        showNotification("DivineLink", body, `appt-${appt.id}-${todayISO}`);
        markNotified(dateKey);
      }
    } catch {
      // DB query failed – skip
    }
  }, 60_000);

  // 4. Low stock pharmacy alert --------------------------------------------
  registerInterval(async () => {
    const todayISO = todayStr();

    try {
      const lowDrugs = await db.drugs
        .filter((d) => d.status === "low" || d.status === "out")
        .toArray();

      for (const drug of lowDrugs) {
        if (!drug.id) continue;

        const dateKey = `dl.notif.stock.${drug.id}.${todayISO}`;
        if (hasNotifiedToday(dateKey)) continue;

        const body = `Stock faible : ${drug.name} - ${drug.stock} restants`;
        showNotification("DivineLink", body, `stock-${drug.id}-${todayISO}`);
        markNotified(dateKey);
      }
    } catch {
      // DB query failed – skip
    }
  }, 5 * 60_000);
}

// ---------------------------------------------------------------------------
// stopSmartNotifications
// ---------------------------------------------------------------------------

export function stopSmartNotifications(): void {
  for (const id of intervalIds) {
    clearInterval(id);
  }
  intervalIds.length = 0;
}
