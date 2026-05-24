import React, { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Upload, TriangleAlert as AlertTriangle, Loader as Loader2, HardDrive, RefreshCw, FileDown, FileUp, Share2, FileJson } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import CryptoJS from "crypto-js";
import { getStorageEstimate, formatBytes } from "@/lib/imageUtils";
import { decryptPatients, encryptPatientForSave } from "@/lib/patientCrypto";
import {
  buildSyncBundle, encryptSyncBundle, decryptSyncBundle, mergeSyncBundle,
  getLastSyncTime, setLastSyncTime, SYNC_EXTENSION, type MergeReport,
} from "@/lib/sync";
import { saveFile, withDateStamp } from "@/lib/download";
import { logAudit } from "@/lib/audit";
import { sanitizeBackup, formatRejected } from "@/lib/backupValidate";
import { useAuth } from "@/contexts/AuthContext";

export function BackupPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const [exportPwd, setExportPwd] = useState("");
  const [importPwd, setImportPwd] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number; percent: number } | null>(null);

  // Sync state
  const [syncPwd, setSyncPwd] = useState("");
  const [syncBusyExport, setSyncBusyExport] = useState(false);
  const [syncBusyImport, setSyncBusyImport] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(getLastSyncTime());
  const [mergeReport, setMergeReport] = useState<MergeReport | null>(null);

  // JSON backup state
  const [jsonBusy, setJsonBusy] = useState(false);
  const [jsonPreview, setJsonPreview] = useState<{ file: File; data: any } | null>(null);
  const [jsonMode, setJsonMode] = useState<"merge" | "replace" | "patientsOnly">("merge");
  const [jsonImporting, setJsonImporting] = useState(false);
  const [jsonProgress, setJsonProgress] = useState(0);
  const [counts, setCounts] = useState<{ patients: number; consultations: number; appointments: number; documents: number } | null>(null);

  useEffect(() => {
    (async () => {
      setCounts({
        patients: await db.patients.count(),
        consultations: await db.consultations.count(),
        appointments: await db.appointments.count(),
        documents: await db.documents.count(),
      });
    })();
  }, []);

  const handleJsonExport = async () => {
    setJsonBusy(true);
    try {
      const payload = {
        version: 9,
        generatedAt: new Date().toISOString(),
        app: "DivineLink",
        data: {
          users: await db.users.toArray(),
          patients: await decryptPatients(await db.patients.toArray()),
          appointments: await db.appointments.toArray(),
          consultations: await db.consultations.toArray(),
          documents: await db.documents.toArray(),
          auditLogs: await db.auditLogs.toArray(),
          drugs: await db.drugs.toArray(),
          drugTransactions: await db.drugTransactions.toArray(),
          generatedDocs: await db.generatedDocs.toArray(),
        },
      };
      const json = JSON.stringify(payload, null, 2);
      const filename = `DivineLink-Backup-${new Date().toISOString().slice(0, 10)}.json`;
      const blob = new Blob([json], { type: "application/json" });

      // Try Web Share API first (Android)
      const file = new File([blob], filename, { type: "application/json" });
      if ((navigator as any).canShare?.({ files: [file] })) {
        try { await (navigator as any).share({ files: [file], title: filename }); }
        catch { /* user cancelled */ }
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      if (user) await logAudit("backup_export", user.name, { message: `json export v6` });
      toast.success(t("backup.success"));
    } catch (e) { toast.error(String(e)); }
    setJsonBusy(false);
  };

  const handleJsonShare = handleJsonExport;

  const handleJsonFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data?.data) { toast.error("Invalid backup file"); return; }
      setJsonPreview({ file, data });
    } catch { toast.error("Invalid JSON file"); }
  };

  const runJsonImport = async () => {
    if (!jsonPreview) return;
    setJsonImporting(true); setJsonProgress(5);
    try {
      const rawIncoming = jsonPreview.data?.data;
      const { data: incoming, report } = sanitizeBackup(rawIncoming);
      const rejectedSummary = formatRejected(report);
      if (rejectedSummary) {
        toast.warning(`Records rejected (invalid shape): ${rejectedSummary}`);
      }

      if (jsonMode === "replace") {
        await db.transaction("rw", [db.users, db.patients, db.appointments, db.consultations, db.documents], async () => {
          await db.users.clear(); await db.patients.clear(); await db.appointments.clear();
          await db.consultations.clear(); await db.documents.clear();
        });
      }
      setJsonProgress(20);

      // Patients (re-encrypt sensitive fields; preserve numeric ids when present)
      if (incoming.patients.length) {
        if (jsonMode === "replace") {
          const reEnc = await Promise.all(incoming.patients.map((p: any) => encryptPatientForSave(p)));
          await db.patients.bulkPut(reEnc as any);
        } else {
          const existing = new Map((await db.patients.toArray()).map(p => [p.patientId, p]));
          for (const p of incoming.patients) {
            // "merge" / "patientsOnly": keep existing patientId rows to avoid accidental duplicates
            if (existing.has(p.patientId)) continue;
            const enc = await encryptPatientForSave({ ...p, id: undefined as any });
            await db.patients.add(enc as any);
          }
        }
      }
      setJsonProgress(50);

      if (jsonMode !== "patientsOnly") {
        // IMPORTANT: consultations/appointments/documents reference numeric patientId.
        // Only safe to import them as-is when doing a full replace (ids preserved).
        if (jsonMode !== "replace") {
          toast.warning("Mode merge: seules les fiches patients sont importées (RDV/consultations/documents ignorés pour éviter des liens incorrects).");
        } else {
          if (incoming.consultations.length) await db.consultations.bulkPut(incoming.consultations as any);
          if (incoming.appointments.length) await db.appointments.bulkPut(incoming.appointments as any);
          if (incoming.documents.length) await db.documents.bulkPut(incoming.documents as any);
          if (incoming.users.length) await db.users.bulkPut(incoming.users as any);
        }
        setJsonProgress(70);
      }
      setJsonProgress(100);

      if (user) await logAudit("backup_import", user.name, { message: `json import mode=${jsonMode} rejected=${rejectedSummary || "none"}` });
      toast.success(t("backup.imported"));
      setJsonPreview(null);
      refreshStorage();
    } catch (err) { toast.error(String(err)); }
    setJsonImporting(false); setJsonProgress(0);
  };

  const refreshStorage = async () => setStorage(await getStorageEstimate());
  useEffect(() => { refreshStorage(); }, []);

  const handleExport = async () => {
    if (!exportPwd) return;
    setExporting(true);
    try {
      const data = {
        users: await db.users.toArray(),
        patients: await decryptPatients(await db.patients.toArray()),
        appointments: await db.appointments.toArray(),
        consultations: await db.consultations.toArray(),
        documents: await db.documents.toArray(),
        exportedAt: new Date().toISOString(),
      };

      const json = JSON.stringify(data);
      const encrypted = CryptoJS.AES.encrypt(json, exportPwd).toString();

      const zip = new JSZip();
      zip.file("divinelink_backup.enc", encrypted);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `divinelink_backup_${new Date().toISOString().split("T")[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("backup.success"));
    } catch (e) {
      toast.error(String(e));
    }
    setExporting(false);
    refreshStorage();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!importPwd || !e.target.files?.[0]) return;
    setImporting(true);
    try {
      const file = e.target.files[0];
      const zip = await JSZip.loadAsync(file);
      const encFile = zip.file("divinelink_backup.enc");
      if (!encFile) throw new Error("Invalid backup file");

      const encrypted = await encFile.async("string");
      const bytes = CryptoJS.AES.decrypt(encrypted, importPwd);
      const json = bytes.toString(CryptoJS.enc.Utf8);
      if (!json) throw new Error("Wrong password");

      const parsed = JSON.parse(json);
      const { data, report } = sanitizeBackup(parsed);
      const rejectedSummary = formatRejected(report);
      if (rejectedSummary) toast.warning(`Records rejected: ${rejectedSummary}`);

      // Clear and restore
      await db.transaction("rw", [db.users, db.patients, db.appointments, db.consultations, db.documents], async () => {
        await db.users.clear();
        await db.patients.clear();
        await db.appointments.clear();
        await db.consultations.clear();
        await db.documents.clear();

        if (data.users.length) await db.users.bulkAdd(data.users);
        if (data.patients.length) {
          const reEnc = await Promise.all(data.patients.map((p: any) => encryptPatientForSave(p)));
          await db.patients.bulkAdd(reEnc);
        }
        if (data.appointments.length) await db.appointments.bulkAdd(data.appointments);
        if (data.consultations.length) await db.consultations.bulkAdd(data.consultations);
        if (data.documents.length) await db.documents.bulkAdd(data.documents);
      });

      toast.success(t("backup.success"));
    } catch (err) {
      toast.error(String(err));
    }
    setImporting(false);
    e.target.value = "";
    refreshStorage();
  };

  const handleSyncExport = async () => {
    if (!syncPwd) return;
    setSyncBusyExport(true);
    setMergeReport(null);
    try {
      const bundle = await buildSyncBundle();
      const total = Object.values(bundle.counts).reduce((a, b) => a + b, 0);
      if (total === 0) {
        toast.info(t("sync.exportNothing"));
        setSyncBusyExport(false);
        return;
      }
      const cipher = encryptSyncBundle(bundle, syncPwd);
      const ok = await saveFile(withDateStamp(`divinelink_changes${SYNC_EXTENSION}`), cipher, "text");
      if (ok) {
        const now = new Date().toISOString();
        setLastSyncTime(now);
        setLastSync(now);
        if (user) await logAudit("backup_export", user.name, { message: `sync export: ${JSON.stringify(bundle.counts)}` });
        toast.success(t("backup.success"));
      }
    } catch (e) {
      toast.error(String(e));
    }
    setSyncBusyExport(false);
  };

  const handleSyncImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !syncPwd) return;
    setSyncBusyImport(true);
    setMergeReport(null);
    try {
      const text = await file.text();
      const bundle = decryptSyncBundle(text, syncPwd);
      const report = await mergeSyncBundle(bundle);
      setMergeReport(report);
      if (user) await logAudit("backup_import", user.name, { message: `sync merge: ${JSON.stringify(report)}` });
      toast.success(t("backup.success"));
      refreshStorage();
    } catch (err) {
      toast.error(t("sync.bad"));
    }
    setSyncBusyImport(false);
    e.target.value = "";
  };

  const resetSyncMarker = () => {
    localStorage.removeItem("dl.sync.lastExport.v1");
    setLastSync(null);
    toast.success("OK");
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Storage gauge */}
      {storage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HardDrive className="w-5 h-5" />{t("storage.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={Math.min(100, storage.percent)} />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{t("storage.used")}: {formatBytes(storage.usage)}</span>
              <span>{storage.percent.toFixed(1)}% {t("storage.of")} {formatBytes(storage.quota)}</span>
            </div>
            {storage.percent >= 70 && (
              <div className="flex items-center gap-2 text-sm text-warning">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {t("storage.warning")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="w-5 h-5" />{t("backup.export")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>{t("backup.password")}</Label>
            <Input type="password" value={exportPwd} onChange={e => setExportPwd(e.target.value)} />
          </div>
          <Button onClick={handleExport} disabled={!exportPwd || exporting} className="w-full gap-2">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? t("backup.exporting") : t("backup.export")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" />{t("backup.import")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {t("backup.warning")}
          </div>
          <div>
            <Label>{t("backup.password")}</Label>
            <Input type="password" value={importPwd} onChange={e => setImportPwd(e.target.value)} />
          </div>
          <Button asChild variant="outline" disabled={!importPwd || importing} className="w-full gap-2">
            <label>
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing ? t("backup.importing") : t("backup.import")}
              <input type="file" accept=".zip" className="hidden" onChange={handleImport} disabled={!importPwd} />
            </label>
          </Button>
        </CardContent>
      </Card>
      </div>

      {/* Manual sync between devices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5" />{t("sync.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("sync.desc")}</p>
          <p className="text-xs text-muted-foreground">
            {t("sync.lastExport")}: <span className="font-mono">{lastSync ? new Date(lastSync).toLocaleString() : t("sync.never")}</span>
          </p>
          <div>
            <Label>{t("sync.passphrase")}</Label>
            <Input type="password" value={syncPwd} onChange={e => setSyncPwd(e.target.value)} placeholder="1234" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSyncExport} disabled={!syncPwd || syncBusyExport} className="gap-2">
              {syncBusyExport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              {syncBusyExport ? t("sync.exporting") : t("sync.exportBtn")}
            </Button>
            <Button asChild variant="outline" disabled={!syncPwd || syncBusyImport} className="gap-2">
              <label className={!syncPwd || syncBusyImport ? "pointer-events-none opacity-50" : "cursor-pointer"}>
                {syncBusyImport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                {syncBusyImport ? t("sync.importing") : t("sync.importBtn")}
                <input type="file" accept=".divinesync,application/octet-stream,text/plain" className="hidden" onChange={handleSyncImport} />
              </label>
            </Button>
            <Button variant="ghost" size="sm" onClick={resetSyncMarker} className="ml-auto text-xs">
              {t("sync.resetMarker")}
            </Button>
          </div>
          {mergeReport && (
            <div className="rounded border p-3 text-sm space-y-1 bg-muted/30">
              <div className="font-medium mb-1">{t("sync.summary")}</div>
              {(["patients", "consultations", "appointments", "documents", "users"] as const).map(k => (
                <div key={k} className="flex justify-between">
                  <span className="capitalize">{k}</span>
                  <span className="text-muted-foreground">
                    +{mergeReport[k].added} {t("sync.added")} • ~{mergeReport[k].updated} {t("sync.updated")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full JSON backup + Device Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileJson className="w-5 h-5" />{t("backup.json.export")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {counts && (
            <p className="text-sm text-muted-foreground">
              {t("backup.json.summary")}: {counts.patients} {t("backup.summary.patients")} • {counts.consultations} {t("backup.summary.consultations")} • {counts.documents} {t("backup.summary.documents")} • {counts.appointments} {t("backup.summary.appointments")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleJsonExport} disabled={jsonBusy} className="gap-2">
              {jsonBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t("backup.json.export")}
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <label className="cursor-pointer">
                <Upload className="w-4 h-4" />{t("backup.json.import")}
                <input type="file" accept="application/json,.json" className="hidden" onChange={handleJsonFilePick} />
              </label>
            </Button>
          </div>

          <div className="border-t pt-4 space-y-2">
            <p className="font-medium text-sm">{t("backup.deviceSync")}</p>
            <p className="text-xs text-muted-foreground">{t("backup.shareHint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleJsonShare} variant="secondary" className="gap-2">
                <Share2 className="w-4 h-4" />{t("backup.share")}
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <label className="cursor-pointer">
                  <FileUp className="w-4 h-4" />{t("backup.receive")}
                  <input type="file" accept="application/json,.json" className="hidden" onChange={handleJsonFilePick} />
                </label>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* JSON import preview dialog */}
      <Dialog open={!!jsonPreview} onOpenChange={o => !o && !jsonImporting && setJsonPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("backup.json.preview")}</DialogTitle></DialogHeader>
          {jsonPreview && (
            <div className="space-y-3">
              <div className="text-sm bg-muted/40 p-3 rounded space-y-1">
                <p>{t("backup.json.summary")}:</p>
                <ul className="list-disc list-inside text-muted-foreground">
                  <li>{jsonPreview.data.data.patients?.length || 0} {t("backup.summary.patients")}</li>
                  <li>{jsonPreview.data.data.consultations?.length || 0} {t("backup.summary.consultations")}</li>
                  <li>{jsonPreview.data.data.documents?.length || 0} {t("backup.summary.documents")}</li>
                  <li>{jsonPreview.data.data.appointments?.length || 0} {t("backup.summary.appointments")}</li>
                </ul>
                {jsonPreview.data.generatedAt && (
                  <p className="text-xs">{t("backup.json.from")} {new Date(jsonPreview.data.generatedAt).toLocaleString()}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Mode</Label>
                {(["merge", "replace", "patientsOnly"] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="json-mode" checked={jsonMode === m} onChange={() => setJsonMode(m)} />
                    {t(`backup.${m === "patientsOnly" ? "patientsOnly" : m}`)}
                  </label>
                ))}
              </div>
              {jsonImporting && <Progress value={jsonProgress} />}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setJsonPreview(null)} disabled={jsonImporting}>{t("common.cancel")}</Button>
                <Button onClick={runJsonImport} disabled={jsonImporting}>
                  {jsonImporting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  {t("backup.json.import")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
