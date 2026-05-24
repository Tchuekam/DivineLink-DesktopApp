/**
 * Local-only usage metrics. Stored in localStorage. Last 90 days kept.
 * No network. No PII.
 */

const KEY = "dl.metrics.v1";
const RETENTION_DAYS = 90;

export interface MetricEvent {
  ts: number; // epoch ms
  kind: "nav" | "search";
  value: string;
}

interface Store {
  events: MetricEvent[];
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { events: [] };
    const parsed = JSON.parse(raw) as Store;
    return parsed?.events ? parsed : { events: [] };
  } catch {
    return { events: [] };
  }
}

function write(s: Store) {
  const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
  s.events = s.events.filter(e => e.ts >= cutoff);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function trackNav(page: string) {
  const s = read();
  s.events.push({ ts: Date.now(), kind: "nav", value: page });
  write(s);
}

export function trackSearch(term: string) {
  const t = term.trim();
  if (!t) return;
  const s = read();
  s.events.push({ ts: Date.now(), kind: "search", value: t.toLowerCase().slice(0, 60) });
  write(s);
}

export function getEvents(): MetricEvent[] {
  return read().events;
}

export function clearMetrics() {
  try { localStorage.removeItem(KEY); } catch {}
}

/* ---------- Aggregations ---------- */

export function pageVisitCounts(): { page: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of getEvents()) if (e.kind === "nav") counts.set(e.value, (counts.get(e.value) || 0) + 1);
  return Array.from(counts.entries())
    .map(([page, count]) => ({ page, count }))
    .sort((a, b) => b.count - a.count);
}

export function topSearches(limit = 10): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of getEvents()) if (e.kind === "search") counts.set(e.value, (counts.get(e.value) || 0) + 1);
  return Array.from(counts.entries())
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function hourlyHistogram(): { hour: string; count: number }[] {
  const buckets = new Array(24).fill(0);
  for (const e of getEvents()) if (e.kind === "nav") buckets[new Date(e.ts).getHours()]++;
  return buckets.map((count, h) => ({ hour: `${String(h).padStart(2, "0")}h`, count }));
}

/** Group records by ISO week (last `weeks` weeks). */
export function weeklyBuckets(timestamps: string[], weeks = 8): { week: string; count: number }[] {
  const out: { week: string; count: number }[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  // start of current week (Mon)
  const dow = (now.getDay() + 6) % 7;
  const startOfWeek = new Date(now.getTime() - dow * 86400_000);
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(startOfWeek.getTime() - i * 7 * 86400_000);
    const we = new Date(ws.getTime() + 7 * 86400_000);
    const label = `${String(ws.getDate()).padStart(2, "0")}/${String(ws.getMonth() + 1).padStart(2, "0")}`;
    const count = timestamps.filter(ts => {
      const t = new Date(ts).getTime();
      return t >= ws.getTime() && t < we.getTime();
    }).length;
    out.push({ week: label, count });
  }
  return out;
}
