import React, { useEffect, useState } from "react";
import mammoth from "mammoth";
import { db, type ImportedDocument, type Consultation, type ConsultationTemplate } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getClinicId } from "@/lib/clinicSettings";
import { TemplateRenderer } from "@/components/TemplateRenderer";

interface Props { doc: ImportedDocument; onClose: () => void; onDone: () => void; }

const SECTION_PATTERNS: { key: string; re: RegExp }[] = [
  { key: "chiefComplaint", re: /\b(plainte|motif|chief complaint|cc)\b/i },
  { key: "historyOfPresentIllness", re: /\b(antécédent|historique|hpi|histoire|history of present)\b/i },
  { key: "medicalHistory", re: /\b(médicaux|past medical|atcd|antécédents médicaux)\b/i },
  { key: "generalExam", re: /\b(examen|exam|physical)\b/i },
  { key: "diagnosis", re: /\b(diagnostic|diagnosis|dg)\b/i },
  { key: "treatmentPlan", re: /\b(traitement|plan|treatment|therapy)\b/i },
  { key: "prescription", re: /\b(prescription|ordonnance|rx)\b/i },
  { key: "notes", re: /\b(notes?|remarques?|observations?)\b/i },
];

function splitSections(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const out: Record<string, string> = {};
  let current = "notes";
  let buf: string[] = [];
  const flush = () => { if (buf.length) out[current] = ((out[current] || "") + "\n" + buf.join("\n")).trim(); buf = []; };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { buf.push(""); continue; }
    const matched = SECTION_PATTERNS.find(p => p.re.test(trimmed) && trimmed.length < 80);
    if (matched) { flush(); current = matched.key; continue; }
    buf.push(line);
  }
  flush();
  return out;
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function WordConversionAssistant({ doc, onClose, onDone }: Props) {
  const { user } = useAuth();
  const [rawText, setRawText] = useState("");
  const [sections, setSections] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<ConsultationTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("__none__");
  const [customValues, setCustomValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ab = dataUrlToArrayBuffer(doc.data);
        const result = await mammoth.extractRawText({ arrayBuffer: ab });
        setRawText(result.value);
        setSections(splitSections(result.value));
      } catch (e: any) {
        toast.error("Extraction impossible: " + (e?.message || e));
      }
    })();
    db.consultationTemplates.filter(t => t.active).toArray().then(setTemplates);
  }, [doc.id]);

  const selectedTpl = templates.find(t => t.id === parseInt(templateId));

  const save = async () => {
    if (!user?.id) return;
    setBusy(true);
    const now = new Date().toISOString();
    const consult: Consultation = {
      patientId: doc.patientId,
      doctorId: user.id,
      date: now,
      symptoms: sections.chiefComplaint || "",
      diagnosis: sections.diagnosis || "",
      treatmentPlan: sections.treatmentPlan || "",
      prescription: sections.prescription || "",
      notes: (sections.notes || "") + (rawText ? `\n\n--- Document source: ${doc.filename} ---` : ""),
      chiefComplaint: sections.chiefComplaint || "",
      historyOfPresentIllness: sections.historyOfPresentIllness || "",
      medicalHistory: sections.medicalHistory || "",
      generalExam: sections.generalExam || "",
      consultType: "general",
      templateId: selectedTpl?.id,
      customFields: Object.keys(customValues).length ? customValues : undefined,
      clinicId: getClinicId(),
      createdAt: now,
      versionNumber: 1,
      isLatest: true,
    };
    const id = await db.consultations.add(consult);
    await db.consultations.update(id as number, { originalId: id as number });
    await db.importedDocuments.update(doc.id!, { convertedConsultationId: id as number });
    toast.success("Consultation créée");
    setBusy(false);
    onDone();
  };

  const FIELD_LABELS: Record<string, string> = {
    chiefComplaint: "Motif de consultation",
    historyOfPresentIllness: "Histoire de la maladie",
    medicalHistory: "Antécédents médicaux",
    generalExam: "Examen général",
    diagnosis: "Diagnostic",
    treatmentPlan: "Plan de traitement",
    prescription: "Prescription",
    notes: "Notes",
  };

  const assignSelectionTo = (field: string) => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel) { toast.info("Sélectionnez d'abord du texte dans le panneau gauche"); return; }
    setSections(s => ({ ...s, [field]: (s[field] ? s[field] + "\n" : "") + sel }));
    toast.success(`Ajouté à « ${FIELD_LABELS[field]} »`);
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="w-full h-[100dvh] max-w-none rounded-none p-4 sm:p-6 sm:h-auto sm:max-w-5xl sm:max-h-[90vh] sm:rounded-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Convertir en consultation — {doc.filename}</DialogTitle></DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT: raw extracted text + manual mapping */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-semibold">Texte extrait (sélectionnez puis assignez)</Label>
              <Select onValueChange={assignSelectionTo}>
                <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Assigner à…" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FIELD_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="border rounded-md p-3 bg-muted/30 text-xs whitespace-pre-wrap max-h-[60vh] overflow-y-auto select-text">
              {rawText || "Extraction…"}
            </div>
          </div>

          {/* RIGHT: editable form fields */}
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-xs">Modèle d'observation</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Aucun</SelectItem>
                  {templates.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedTpl && (
              <div className="border rounded-md p-3">
                <p className="text-xs font-semibold mb-2">Champs du modèle</p>
                <TemplateRenderer fields={selectedTpl.fieldsDefinition} values={customValues} onChange={setCustomValues} />
              </div>
            )}
            {Object.entries(FIELD_LABELS).map(([k, label]) => (
              <div key={k}>
                <Label className="text-xs">{label}</Label>
                <Textarea
                  rows={2}
                  value={sections[k] || ""}
                  onChange={e => setSections(s => ({ ...s, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={save} disabled={busy}>Valider et créer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
