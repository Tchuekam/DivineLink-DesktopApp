import { db, type AuditEventType } from "@/lib/db";

export async function logAudit(
  type: AuditEventType,
  userName: string,
  details: { resource?: string; resourceId?: string | number; message?: string } = {}
): Promise<void> {
  try {
    await db.auditLogs.add({
      timestamp: new Date().toISOString(),
      userName,
      type,
      resource: details.resource,
      resourceId: details.resourceId != null ? String(details.resourceId) : undefined,
      message: details.message,
    });
  } catch (e) {
    // never throw from audit
    console.warn("[audit] failed to log", e);
  }
}

export function exportAuditCsv(rows: any[]): string {
  const headers = ["timestamp", "userName", "type", "resource", "resourceId", "message"];
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
}

export function downloadFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
