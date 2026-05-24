/**
 * Universal file download helper.
 * Uses the File System Access API (showSaveFilePicker) when available,
 * otherwise falls back to a hidden <a download> trigger.
 * All operations are 100% local — no network calls.
 */

export type DownloadKind = "csv" | "json" | "html" | "text" | "binary";

const MIME: Record<DownloadKind, string> = {
  csv: "text/csv;charset=utf-8",
  json: "application/json",
  html: "text/html;charset=utf-8",
  text: "text/plain;charset=utf-8",
  binary: "application/octet-stream",
};

const EXT_DESC: Record<DownloadKind, { description: string; ext: string }> = {
  csv: { description: "CSV file", ext: ".csv" },
  json: { description: "JSON file", ext: ".json" },
  html: { description: "HTML file", ext: ".html" },
  text: { description: "Text file", ext: ".txt" },
  binary: { description: "Data file", ext: "" },
};

/** Add YYYY-MM-DD to a base name, before its extension. */
export function withDateStamp(base: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const dot = base.lastIndexOf(".");
  if (dot === -1) return `${base}_${date}`;
  return `${base.slice(0, dot)}_${date}${base.slice(dot)}`;
}

/** Convert an array of plain objects to a CSV string (RFC 4180-ish). */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return columns?.join(",") ?? "";
  const cols = columns ?? Array.from(rows.reduce((s, r) => {
    Object.keys(r).forEach(k => s.add(k));
    return s;
  }, new Set<string>()));
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(",");
  const body = rows.map(r => cols.map(c => escape((r as any)[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

/** Save text/blob to disk. Returns true on success, false if cancelled. */
export async function saveFile(
  filename: string,
  content: string | Blob,
  kind: DownloadKind = "text",
): Promise<boolean> {
  const mime = MIME[kind];
  const blob = typeof content === "string" ? new Blob([content], { type: mime }) : content;

  // Modern API
  // @ts-ignore - showSaveFilePicker is not yet in lib.dom for all targets
  if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
    try {
      const meta = EXT_DESC[kind];
      // @ts-ignore
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: meta.description, accept: { [mime]: [meta.ext].filter(Boolean) as string[] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e: any) {
      // User cancelled — don't fall back
      if (e && (e.name === "AbortError" || e.code === 20)) return false;
      // Other errors → fall back to anchor
    }
  }

  // Fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
