import React, { useEffect, useState } from "react";
import { db, type ImportedDocument } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Download, Eye, FileText, Trash2, Upload, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { WordConversionAssistant } from "@/components/WordConversionAssistant";
import { getClinicId } from "@/lib/clinicSettings";

interface Props { patientId: number; }

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function ImportedDocumentsTab({ patientId }: Props) {
  const [docs, setDocs] = useState<ImportedDocument[]>([]);
  const [convertDoc, setConvertDoc] = useState<ImportedDocument | null>(null);

  const load = async () => {
    const all = await db.importedDocuments.where("patientId").equals(patientId).toArray();
    setDocs(all.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
  };
  useEffect(() => { load(); }, [patientId]);

  const upload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const now = new Date().toISOString();
      const id = await db.importedDocuments.add({
        patientId, filename: file.name, mimeType: file.type || "application/octet-stream",
        data: reader.result as string, size: file.size, source: "manual",
        clinicId: getClinicId(), uploadedAt: now,
      });
      toast.success("Document ajouté");
      await load();
      // Auto-trigger conversion for .docx files
      if (/\.docx?$/i.test(file.name)) {
        const inserted = await db.importedDocuments.get(id as number);
        if (inserted) setConvertDoc(inserted);
      }
    };
    reader.readAsDataURL(file);
  };

  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  const download = (d: ImportedDocument) => {
    const blob = dataUrlToBlob(d.data);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = d.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const view = (d: ImportedDocument) => {
    const blob = dataUrlToBlob(d.data);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const remove = async (id: number) => {
    if (!confirm("Supprimer ce document ?")) return;
    await db.importedDocuments.delete(id);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{docs.length} document(s)</p>
        <label className="cursor-pointer">
          <input type="file" accept=".doc,.docx,.pdf" className="hidden" onChange={e => e.target.files && upload(e.target.files[0])} />
          <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border hover:bg-accent"><Upload className="w-3 h-3" />Ajouter</span>
        </label>
      </div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center text-xs transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30"}`}
      >
        <Upload className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />
        Glissez-déposez un fichier .docx ici (conversion automatique)
      </div>
      {docs.length === 0 && <p className="text-sm text-muted-foreground">Aucun document importé.</p>}
      {docs.map(d => (
        <Card key={d.id} className="p-3 flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{d.filename}</p>
            <p className="text-xs text-muted-foreground">{(d.size / 1024).toFixed(1)} KB · {new Date(d.uploadedAt).toLocaleDateString()}{d.convertedConsultationId ? " · ✓ converti" : ""}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={() => view(d)} title="Voir"><Eye className="w-4 h-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => download(d)} title="Télécharger"><Download className="w-4 h-4" /></Button>
          {/\.docx?$/i.test(d.filename) && (
            <Button size="icon" variant="ghost" onClick={() => setConvertDoc(d)} title="Convertir en consultation"><Sparkles className="w-4 h-4" /></Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => remove(d.id!)} title="Supprimer"><Trash2 className="w-4 h-4" /></Button>
        </Card>
      ))}
      {convertDoc && (
        <WordConversionAssistant
          doc={convertDoc}
          onClose={() => setConvertDoc(null)}
          onDone={() => { setConvertDoc(null); load(); }}
        />
      )}
    </div>
  );
}
