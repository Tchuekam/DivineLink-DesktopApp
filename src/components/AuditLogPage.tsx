import React, { useEffect, useMemo, useState } from "react";
import { db, type AuditLog, type AuditEventType } from "@/lib/db";
import { exportAuditCsv, downloadFile, logAudit } from "@/lib/audit";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, FileJson, Trash2, ScrollText } from "lucide-react";
import { toast } from "sonner";

const TYPES: AuditEventType[] = [
  "login", "login_fail", "logout",
  "patient_create", "patient_update", "patient_delete", "patient_view",
  "consult_create", "consult_update", "consult_delete", "consult_view",
  "prescription_print",
  "appointment_create", "appointment_update", "appointment_delete",
  "user_create", "user_update", "user_delete",
  "backup_export", "backup_import",
  "wipe_secret_generated", "wipe_secret_changed",
  "master_pin_changed", "audit_export",
  "payment_create", "payment_update", "payment_delete", "payment_installment",
  "drug_create", "drug_update", "drug_delete", "drug_receive", "drug_dispense",
];

export function AuditLogPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");

  const load = async () => {
    const all = await db.auditLogs.orderBy("timestamp").reverse().toArray();
    setLogs(all);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (type !== "all" && l.type !== type) return false;
      if (q) {
        const hay = `${l.userName} ${l.type} ${l.resource ?? ""} ${l.resourceId ?? ""} ${l.message ?? ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [logs, q, type]);

  const exportCsv = () => {
    downloadFile(`divinelink-audit-${new Date().toISOString().split("T")[0]}.csv`,
      exportAuditCsv(filtered), "text/csv");
    if (user) logAudit("audit_export", user.name, { message: `csv ${filtered.length} rows` });
  };
  const exportJson = () => {
    downloadFile(`divinelink-audit-${new Date().toISOString().split("T")[0]}.json`,
      JSON.stringify(filtered, null, 2), "application/json");
    if (user) logAudit("audit_export", user.name, { message: `json ${filtered.length} rows` });
  };

  const purgeAll = async () => {
    if (!confirm(t("audit.confirmPurge"))) return;
    await db.auditLogs.clear();
    toast.success(t("audit.purged"));
    load();
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScrollText className="w-5 h-5" />{t("audit.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder={t("audit.search")} value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("audit.allTypes")}</SelectItem>
                {TYPES.map(tt => <SelectItem key={tt} value={tt}>{tt}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={exportCsv}><Download className="w-4 h-4 mr-1" />CSV</Button>
              <Button variant="outline" size="sm" onClick={exportJson}><FileJson className="w-4 h-4 mr-1" />JSON</Button>
              <Button variant="destructive" size="sm" onClick={purgeAll}><Trash2 className="w-4 h-4 mr-1" />{t("audit.purge")}</Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {filtered.length} / {logs.length} {t("audit.entries")}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="p-2">{t("audit.time")}</th>
                    <th className="p-2">{t("audit.user")}</th>
                    <th className="p-2">{t("audit.type")}</th>
                    <th className="p-2">{t("audit.resource")}</th>
                    <th className="p-2">{t("audit.message")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(l => (
                    <tr key={l.id} className="border-t">
                      <td className="p-2 whitespace-nowrap text-xs">{new Date(l.timestamp).toLocaleString()}</td>
                      <td className="p-2">{l.userName}</td>
                      <td className="p-2"><Badge variant={l.type.includes("fail") || l.type.includes("delete") ? "destructive" : "secondary"}>{l.type}</Badge></td>
                      <td className="p-2 text-xs">{l.resource}{l.resourceId ? ` #${l.resourceId}` : ""}</td>
                      <td className="p-2 text-xs text-muted-foreground">{l.message}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">{t("common.noData")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
