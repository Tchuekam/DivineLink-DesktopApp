/**
 * Clinic profile + auto-generated clinicId.
 * Stored in localStorage (small, frequently read, doesn't need encryption).
 */

export interface ClinicSettings {
  clinicId: string;
  name: string;
  logo?: string;        // base64 data URL
  address?: string;
  city?: string;
  region?: string;
  phone?: string;
  email?: string;
  doctorName?: string;
  licenseNumber?: string;
  openingHours?: string;
  currency?: string;    // default "FCFA"
  createdAt: string;
}

const KEY = "divinelink.clinic";
const ID_KEY = "divinelink.clinicId";

export function getClinicSettings(): ClinicSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ClinicSettings;
  } catch {
    return null;
  }
}

export function saveClinicSettings(s: ClinicSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
  localStorage.setItem(ID_KEY, s.clinicId);
}

export function isClinicConfigured(): boolean {
  const s = getClinicSettings();
  return !!s && !!s.name && s.name.trim().length > 0;
}

/** CLINIC-[CITY3]-[4CHARS]-[YEAR] */
export function generateClinicId(city?: string): string {
  const cityCode = (city || "GEN").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3).padEnd(3, "X");
  const letters = Array.from({ length: 4 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
  const year = new Date().getFullYear();
  return `CLINIC-${cityCode}-${letters}-${year}`;
}

/** Returns current clinicId, or a stable default if none configured yet. */
export function getClinicId(): string {
  const cached = localStorage.getItem(ID_KEY);
  if (cached) return cached;
  const s = getClinicSettings();
  if (s?.clinicId) {
    localStorage.setItem(ID_KEY, s.clinicId);
    return s.clinicId;
  }
  // Bootstrap default so records inserted before onboarding still have an ID.
  const fallback = generateClinicId("GEN");
  localStorage.setItem(ID_KEY, fallback);
  return fallback;
}
