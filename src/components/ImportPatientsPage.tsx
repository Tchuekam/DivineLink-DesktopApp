import React, { useState } from "react";
import * as XLSX from "xlsx";
import { db, generatePatientId, type Patient, type ImportedDocument } from "@/lib/db";
import { encryptPatientForSave } from "@/lib/patientCrypto";
import { getClinicId } from "@/lib/clinicSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileSpreadsheet, FolderUp, Save } from "lucide-react";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";

type DuplicateAction = "ignore" | "update" | "new";

interface ImportRow {
  external_id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  dob?: string;
  address?: string;
  word_filename?: string;
  _existing?: Patient;
  _action: DuplicateAction;
  _selected: boolean;
}

const EXPECTED = ["external_id", "first_name", "last_name", "phone", "dob", "address", "word_filename"];

function normalizeRow(raw: any): Partial<ImportRow> {
  const out: any = {};
  for (const key of Object.keys(raw)) {
    const k = key.toLowerCase().trim().replace(/\s+/g, "_");
    if (EXPECTED.includes(k)) out[k] = String(raw[key] ?? "").trim();
  }
  return out;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function ImportPatientsPage() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [wordFiles, setWordFiles] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const all = await db.patients.toArray();
      const norm: ImportRow[] = [];
      for (const raw of json) {
        const r = normalizeRow(raw) as ImportRow;
        if (!r.first_name && !r.last_name && !r.external_id) continue;
        const existing = r.external_id ? all.find(p => p.externalId === r.external_id) : undefined;
        norm.push({ ...r, _existing: existing, _action: existing ? "ignore" : "new", _selected: true });
      }
      setRows(norm);
      toast.success(`${norm.length} ligne(s) lue(s)`);
    } catch (e: any) {
      toast.error("Erreur de lecture: " + (e?.message || e));
    }
  };

  const handleWordFolder = (files: FileList | null) => {
    if (!files) return;
    const map: Record<string, File> = {};
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (/\.(docx?|pdf)$/i.test(f.name)) map[f.name] = f;
    }
    setWordFiles(map);
    toast.success(`${Object.keys(map).length} document(s) prêt(s)`);
  };

  const runImport = async () => {
    setBusy(true);
    const now = new Date().toISOString();
    const cid = getClinicId();
    let created = 0, updated = 0, ignored = 0, docs = 0;
    for (const r of rows) {
      if (!r._selected) { ignored++; continue; }
      const baseData: Partial<Patient> = {
        externalId: r.external_id || undefined,
        firstName: r.first_name || "",
        lastName: r.last_name || "",
        phone: r.phone || "",
        dob: r.dob || "",
        address: r.address || "",
        medicalAlerts: "",
        clinicId: cid,
        updatedAt: now,
      };
      let patientId: number | undefined;
      if (r._existing && r._action === "ignore") { ignored++; continue; }
      if (r._existing && r._action === "update") {
        const enc = await encryptPatientForSave(baseData);
        await db.patients.update(r._existing.id!, enc);
        patientId = r._existing.id;
        updated++;
      } else {
        const pid = await generatePatientId();
        const full: Patient = {
          ...(baseData as Patient),
          patientId: pid,
          createdAt: now,
        };
        const enc = await encryptPatientForSave(full);
        patientId = (await db.patients.add(enc as Patient)) as number;
        created++;
      }
      if (r.word_filename && wordFiles[r.word_filename] && patientId) {
        const f = wordFiles[r.word_filename];
        const dataUrl = await fileToBase64(f);
        const doc: ImportedDocument = {
          patientId,
          filename: f.name,
          mimeType: f.type || "application/octet-stream",
          data: dataUrl,
          size: f.size,
          source: "import",
          clinicId: cid,
          uploadedAt: now,
        };
        await db.importedDocuments.add(doc);
        docs++;
      }
    }
    await logAudit("backup_import", "system", { message: `Import patients: +${created} maj ${updated} doc ${docs}` });
    toast.success(`${created} créés · ${updated} mis à jour · ${ignored} ignorés · ${docs} documents`);
    setBusy(false);
    setRows([]);
    setWordFiles({});
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Importer des patients (Excel / CSV)</h2>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" />Fichier patients</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Colonnes attendues : external_id, first_name, last_name, phone, dob, address, word_filename</p>
          <Input type="file" accept=".xlsx,.xls,.csv" onChange={e => e.target.files && handleFile(e.target.files[0])} />
          <div>
            <Label className="text-xs flex items-center gap-1"><FolderUp className="w-3 h-3" />Dossier de documents Word/PDF associés (optionnel)</Label>
            <input type="file" multiple onChange={e => handleWordFolder(e.target.files)} className="mt-1 text-sm" />
            {Object.keys(wordFiles).length > 0 && <p className="text-xs text-muted-foreground mt-1">{Object.keys(wordFiles).length} fichier(s) chargé(s)</p>}
          </div>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Aperçu ({rows.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b">
                <tr className="text-left">
                  <th className="p-1"></th>
                  <th className="p-1">Ext. ID</th>
                  <th className="p-1">Nom</th>
                  <th className="p-1">Tél</th>
                  <th className="p-1">DDN</th>
                  <th className="p-1">Doc</th>
                  <th className="p-1">État</th>
                  <th className="p-1">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-1"><input type="checkbox" checked={r._selected} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, _selected: e.target.checked } : x))} /></td>
                    <td className="p-1 font-mono">{r.external_id}</td>
                    <td className="p-1">{r.first_name} {r.last_name}</td>
                    <td className="p-1">{r.phone}</td>
                    <td className="p-1">{r.dob}</td>
                    <td className="p-1">{r.word_filename ? (wordFiles[r.word_filename] ? <Badge variant="outline">OK</Badge> : <Badge variant="destructive">?</Badge>) : "—"}</td>
                    <td className="p-1">{r._existing ? <Badge variant="destructive">Doublon</Badge> : <Badge>Nouveau</Badge>}</td>
                    <td className="p-1">
                      {r._existing ? (
                        <Select value={r._action} onValueChange={v => setRows(rs => rs.map((x, j) => j === i ? { ...x, _action: v as DuplicateAction } : x))}>
                          <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ignore">Ignorer</SelectItem>
                            <SelectItem value="update">Mettre à jour</SelectItem>
                            <SelectItem value="new">Créer nouveau</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRows([]); setWordFiles({}); }}>Annuler</Button>
              <Button onClick={runImport} disabled={busy} className="gap-2"><Save className="w-4 h-4" />Importer</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
