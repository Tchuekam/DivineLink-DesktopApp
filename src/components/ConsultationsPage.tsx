import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, type Consultation, type ConsultationImage, type ConsultationImageType, type Patient, type VitalSigns, type ConsultationType, type ConsultationTemplate } from "@/lib/db";
import { TemplateRenderer } from "@/components/TemplateRenderer";
import { computeBMI, hasFatalAllergy, joinFullName, ageFromDob } from "@/lib/patientHelpers";
import { TriangleAlert as AlertTri, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Printer, Pencil as Edit, Trash2, History, TriangleAlert as AlertTriangle, Upload, X, Pencil, GitCompareArrows, Download, Stethoscope, Save, Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { fileToDataUrl } from "@/lib/imageUtils";
import { decryptPatients } from "@/lib/patientCrypto";
import { AnnotateImageModal } from "@/components/AnnotateImageModal";
import { BeforeAfterCompare } from "@/components/BeforeAfterCompare";
import { saveFile, withDateStamp } from "@/lib/download";
import { formatDateTime } from "@/lib/dateFormat";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ConsultForm {
  // Identification
  patientId: string;
  consultType: ConsultationType;
  specialty: string;
  // Anamnèse
  chiefComplaint: string;
  historyOfPresentIllness: string;
  medicalHistory: string;
  dentalHistory: string;
  reviewOfSystems: string;
  // Examen physique
  generalExam: string;
  vitals: VitalSigns;
  weight: string;
  height: string;
  bmi: string;
  // Examen dentaire court
  oralFindings: string;
  caries: boolean;
  missingTeeth: boolean;
  mobility: boolean;
  pocketDepth: boolean;
  prosthetics: boolean;
  orthodonticAppliances: boolean;
  // Assessment & Plan
  diagnosis: string;
  treatmentPlan: string;
  prescription: string;
  notes: string;
  // Images
  images: ConsultationImage[];
}

type ConsultationWithMeta = Consultation & { patientName: string };

// ─── Constants ──────────────────────────────────────────────────────────────

const SPECIALTIES = [
  "Médecine générale", "Pédiatrie", "Chirurgie", "Gynécologie", "Cardiologie",
  "Neurologie", "Pneumologie", "Gastroentérologie", "Ophtalmologie", "ORL",
  "Dermatologie", "Urologie", "Rhumatologie", "Endocrinologie", "Psychiatrie",
  "Oncologie", "Infectiologie", "Traumatologie", "Dentisterie", "Autre",
];

const EMPTY_FORM: ConsultForm = {
  patientId: "",
  consultType: "general",
  specialty: "Médecine générale",
  chiefComplaint: "",
  historyOfPresentIllness: "",
  medicalHistory: "",
  dentalHistory: "",
  reviewOfSystems: "",
  generalExam: "",
  vitals: {},
  weight: "",
  height: "",
  bmi: "",
  oralFindings: "",
  caries: false,
  missingTeeth: false,
  mobility: false,
  pocketDepth: false,
  prosthetics: false,
  orthodonticAppliances: false,
  diagnosis: "",
  treatmentPlan: "",
  prescription: "",
  notes: "",
  images: [],
};

function generateConsultNumber(seq: number): string {
  return `CONS-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;
}

// ─── Voice-to-text hook ──────────────────────────────────────────────────────

function useSpeechRecognition(onResult: (text: string) => void) {
  const recognitionRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const supported = typeof window !== "undefined" &&
    (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition);

  const start = useCallback(() => {
    if (!supported) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = "fr-FR";
    r.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      onResult(transcript);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    r.start();
    recognitionRef.current = r;
    setListening(true);
  }, [supported, onResult]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  return { supported, listening, start, stop };
}

// ─── MicBtn component ────────────────────────────────────────────────────────

interface MicBtnProps {
  field: keyof ConsultForm;
  form: ConsultForm;
  setForm: React.Dispatch<React.SetStateAction<ConsultForm>>;
}

function MicBtn({ field, form, setForm }: MicBtnProps) {
  const onResult = useCallback((text: string) => {
    setForm(f => {
      const prev = (f[field] as string) || "";
      return { ...f, [field]: prev ? `${prev} ${text}` : text };
    });
  }, [field, setForm]);

  const { supported, listening, start, stop } = useSpeechRecognition(onResult);
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      className={`p-1.5 rounded-md transition-colors ${listening ? "bg-red-100 text-red-600 animate-pulse" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
      title={listening ? "Arrêter la dictée" : "Dictée vocale"}
    >
      {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </button>
  );
}

// ─── VoiceTextarea component ─────────────────────────────────────────────────

interface VoiceTextareaProps {
  label: string;
  field: keyof ConsultForm;
  form: ConsultForm;
  setForm: React.Dispatch<React.SetStateAction<ConsultForm>>;
  rows?: number;
  placeholder?: string;
  required?: boolean;
}

function VoiceTextarea({ label, field, form, setForm, rows = 3, placeholder, required }: VoiceTextareaProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Label>{label}{required && " *"}</Label>
        <MicBtn field={field} form={form} setForm={setForm} />
      </div>
      <Textarea
        rows={rows}
        value={(form[field] as string) || ""}
        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
        placeholder={placeholder}
      />
    </div>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

interface SectionProps {
  num: number;
  title: string;
  complete: boolean;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ num, title, complete, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${complete ? "bg-green-500 text-white" : "bg-orange-400 text-white"}`}>
          {num || "★"}
        </span>
        <span className="flex-1 font-semibold text-sm">{title}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${complete ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
          {complete ? "✓" : "—"}
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="p-4 space-y-4 border-t">{children}</div>}
    </div>
  );
}

// ─── Form ↔ DB conversion ─────────────────────────────────────────────────────

function formToConsultFields(form: ConsultForm): Partial<Consultation> {
  const bmiVal = form.bmi ? parseFloat(form.bmi) : undefined;
  return {
    symptoms: form.chiefComplaint,
    diagnosis: form.diagnosis,
    treatmentPlan: form.treatmentPlan,
    prescription: form.prescription,
    notes: form.notes,
    vitals: {
      ...form.vitals,
      weight: form.weight ? parseFloat(form.weight) : form.vitals.weight,
      height: form.height ? parseFloat(form.height) : form.vitals.height,
      bmi: bmiVal ?? form.vitals.bmi,
    },
    images: form.images,
    consultType: form.consultType,
    chiefComplaint: form.chiefComplaint,
    historyOfPresentIllness: form.historyOfPresentIllness,
    medicalHistory: form.medicalHistory,
    dentalHistory: form.dentalHistory,
    reviewOfSystems: form.reviewOfSystems,
    generalExam: form.generalExam,
    anthropometric: {
      weight: form.weight ? parseFloat(form.weight) : undefined,
      height: form.height ? parseFloat(form.height) : undefined,
      bmi: bmiVal,
    },
    oralFindings: form.oralFindings,
    dentalCheckboxes: {
      caries: form.caries,
      missingTeeth: form.missingTeeth,
      mobility: form.mobility,
      pocketDepth: form.pocketDepth,
      prosthetics: form.prosthetics,
      orthodonticAppliances: form.orthodonticAppliances,
    },
  };
}

function consultToForm(c: Consultation): ConsultForm {
  const dc = c.dentalCheckboxes || {};
  const anthro = c.anthropometric || {};
  return {
    ...EMPTY_FORM,
    patientId: c.patientId.toString(),
    consultType: c.consultType || "general",
    chiefComplaint: c.chiefComplaint || c.symptoms || "",
    historyOfPresentIllness: c.historyOfPresentIllness || "",
    medicalHistory: c.medicalHistory || "",
    dentalHistory: c.dentalHistory || "",
    reviewOfSystems: c.reviewOfSystems || "",
    generalExam: c.generalExam || "",
    vitals: c.vitals || {},
    weight: anthro.weight != null ? String(anthro.weight) : c.vitals?.weight != null ? String(c.vitals.weight) : "",
    height: anthro.height != null ? String(anthro.height) : c.vitals?.height != null ? String(c.vitals.height) : "",
    bmi: anthro.bmi != null ? String(anthro.bmi) : c.vitals?.bmi != null ? String(c.vitals.bmi) : "",
    oralFindings: c.oralFindings || "",
    caries: dc.caries ?? false,
    missingTeeth: dc.missingTeeth ?? false,
    mobility: dc.mobility ?? false,
    pocketDepth: dc.pocketDepth ?? false,
    prosthetics: dc.prosthetics ?? false,
    orthodonticAppliances: dc.orthodonticAppliances ?? false,
    diagnosis: c.diagnosis || "",
    treatmentPlan: c.treatmentPlan || "",
    prescription: c.prescription || "",
    notes: c.notes || "",
    images: (c.images || []).map(i => ({ ...i, imgType: i.imgType ?? "other" })),
  };
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ConsultationsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [consultations, setConsultations] = useState<ConsultationWithMeta[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [printDialog, setPrintDialog] = useState<Consultation | null>(null);
  const [historyDialog, setHistoryDialog] = useState<ConsultationWithMeta[] | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [form, setForm] = useState<ConsultForm>(EMPTY_FORM);
  const [consultNumber, setConsultNumber] = useState("");
  const [previewImg, setPreviewImg] = useState<ConsultationImage | null>(null);
  const [templates, setTemplates] = useState<ConsultationTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("__none__");
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  useEffect(() => { db.consultationTemplates.filter(t => t.active).toArray().then(setTemplates); }, []);
  const selectedTemplate = templates.find(t => t.id === parseInt(templateId));
  const [selectedImgIds, setSelectedImgIds] = useState<string[]>([]);
  const [annotateImg, setAnnotateImg] = useState<ConsultationImage | null>(null);
  const [compareDialog, setCompareDialog] = useState<{ before: ConsultationImage; after: ConsultationImage } | null>(null);
  const [dxOpen, setDxOpen] = useState(false);
  const autosaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const DRAFT_KEY = "divinelink.consultDraft";

  const load = useCallback(async () => {
    const allPatients = await decryptPatients(await db.patients.toArray());
    setPatients(allPatients);
    const all = await db.consultations.where("isLatest").equals(1).reverse().toArray();
    const fallback = all.length === 0 ? await db.consultations.reverse().toArray() : all;
    setConsultations(fallback.filter(c => c.isLatest !== false).map(c => {
      const p = allPatients.find(p => p.id === c.patientId);
      return { ...c, patientName: p ? `${p.firstName} ${p.lastName}` : "—" };
    }));
  }, []);

  useEffect(() => { load(); }, [load]);

  const startAutosave = useCallback((getForm: () => ConsultForm) => {
    if (autosaveRef.current) clearInterval(autosaveRef.current);
    autosaveRef.current = setInterval(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(getForm()));
        toast.info(t("obs.autosaved"), { duration: 1500 });
      } catch { /* ignore */ }
    }, 30000);
  }, [t]);

  useEffect(() => () => { if (autosaveRef.current) clearInterval(autosaveRef.current); }, []);

  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);

  const openNew = async () => {
    setEditingId(null);
    const draft = (() => {
      try { const d = localStorage.getItem(DRAFT_KEY); return d ? JSON.parse(d) : null; } catch { return null; }
    })();
    const seq = (await db.consultations.count()) + 1;
    setConsultNumber(generateConsultNumber(seq));
    setForm(draft ?? { ...EMPTY_FORM });
    setSelectedImgIds([]);
    setDialogOpen(true);
    startAutosave(() => formRef.current);
  };

  const openEdit = (c: Consultation) => {
    setEditingId(c.id!);
    setForm(consultToForm(c));
    setConsultNumber(`CONS-${new Date(c.createdAt || c.date).getFullYear()}-????`);
    setSelectedImgIds([]);
    setDialogOpen(true);
    startAutosave(() => formRef.current);
  };

  const closeDialog = () => {
    if (autosaveRef.current) clearInterval(autosaveRef.current);
    setDialogOpen(false);
  };

  // ── Image helpers ──
  const handleAddImages = async (e: React.ChangeEvent<HTMLInputElement>, forceType?: ConsultationImageType) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      const newImages: ConsultationImage[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const data = await fileToDataUrl(file);
        const imgType: ConsultationImageType = forceType
          ? (i % 2 === 0 ? "before" : "after")
          : "other";
        newImages.push({ id: crypto.randomUUID(), filename: file.name, data, uploadedAt: new Date().toISOString(), caption: "", imgType });
      }
      setForm(f => ({ ...f, images: [...f.images, ...newImages] }));
    } catch { toast.error("Image error"); }
    e.target.value = "";
  };

  const removeImage = (id: string) => {
    setForm(f => ({
      ...f,
      images: f.images.filter(i => i.id !== id).map(i => i.pairedWith === id ? { ...i, pairedWith: undefined } : i),
    }));
    setSelectedImgIds(s => s.filter(x => x !== id));
  };

  const updateCaption = (id: string, caption: string) =>
    setForm(f => ({ ...f, images: f.images.map(i => i.id === id ? { ...i, caption } : i) }));

  const updateImgType = (id: string, imgType: ConsultationImageType) =>
    setForm(f => ({ ...f, images: f.images.map(i => i.id === id ? { ...i, imgType } : i) }));

  const toggleSelect = (id: string) =>
    setSelectedImgIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const canPair = useMemo(() => {
    if (selectedImgIds.length !== 2) return false;
    const sel = form.images.filter(i => selectedImgIds.includes(i.id));
    const types = sel.map(i => i.imgType).sort();
    return types[0] === "after" && types[1] === "before";
  }, [selectedImgIds, form.images]);

  const pairSelected = () => {
    if (!canPair) return;
    const [a, b] = form.images.filter(i => selectedImgIds.includes(i.id));
    setForm(f => ({ ...f, images: f.images.map(i => i.id === a.id ? { ...i, pairedWith: b.id } : i.id === b.id ? { ...i, pairedWith: a.id } : i) }));
    setSelectedImgIds([]);
    toast.success(t("img.paired"));
  };

  const unpair = (id: string) => {
    const target = form.images.find(i => i.id === id);
    if (!target?.pairedWith) return;
    const otherId = target.pairedWith;
    setForm(f => ({ ...f, images: f.images.map(i => (i.id === id || i.id === otherId) ? { ...i, pairedWith: undefined } : i) }));
  };

  const openCompare = (img: ConsultationImage) => {
    if (!img.pairedWith) return;
    const other = form.images.find(i => i.id === img.pairedWith);
    if (!other) return;
    const before = img.imgType === "before" ? img : other;
    const after = img.imgType === "after" ? img : other;
    setCompareDialog({ before, after });
  };

  const saveAnnotation = (dataUrl: string) => {
    if (!annotateImg) return;
    const newImg: ConsultationImage = {
      id: crypto.randomUUID(),
      filename: `annotation-${annotateImg.filename}`,
      data: dataUrl,
      uploadedAt: new Date().toISOString(),
      caption: `Annotation of ${annotateImg.filename}`,
      imgType: "annotation",
      annotationOf: annotateImg.id,
    };
    setForm(f => ({ ...f, images: [...f.images, newImg] }));
    setAnnotateImg(null);
    toast.success(t("annotate.save"));
  };

  const exportConsultJson = async (c: ConsultationWithMeta) => {
    const json = JSON.stringify(c, null, 2);
    const ok = await saveFile(withDateStamp(`consultation_${c.patientName.replace(/\s+/g, "_")}.json`), json, "json");
    if (ok) toast.success(t("download.done"));
  };

  const save = async () => {
    if (!form.patientId) return;
    const now = new Date().toISOString();
    const fields = formToConsultFields(form);

    if (editingId) {
      const old = await db.consultations.get(editingId);
      if (old) {
        await db.consultations.update(editingId, { isLatest: false });
        const originalId = old.originalId || old.id!;
        await db.consultations.add({
          ...fields,
          patientId: parseInt(form.patientId),
          doctorId: user!.id!,
          date: now,
          createdAt: now,
          originalId,
          isLatest: true,
          versionNumber: (old.versionNumber || 1) + 1,
          editedAt: now,
          editedBy: user!.name,
        } as Consultation);
      }
      toast.success(t("consult.updated"));
    } else {
      const id = await db.consultations.add({
        ...fields,
        patientId: parseInt(form.patientId),
        doctorId: user!.id!,
        date: now,
        createdAt: now,
        versionNumber: 1,
      } as Consultation);
      await db.consultations.update(id as number, { originalId: id as number });
      toast.success(t("consult.new"));
    }
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    closeDialog();
    load();
  };

  const handleDelete = async (id: number) => {
    const c = await db.consultations.get(id);
    if (c) {
      const origId = c.originalId || c.id!;
      await db.consultations.where("originalId").equals(origId).delete();
      await db.consultations.delete(origId);
    }
    setDeleteConfirm(null);
    toast.success(t("common.delete"));
    load();
  };

  const showHistory = async (c: Consultation) => {
    const origId = c.originalId || c.id!;
    const allPatients = await decryptPatients(await db.patients.toArray());
    const versions = await db.consultations.where("originalId").equals(origId).reverse().toArray();
    const orig = await db.consultations.get(origId);
    const allVersions = orig && !versions.find(v => v.id === orig.id) ? [...versions, orig] : versions;
    setHistoryDialog(
      allVersions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(v => {
        const p = allPatients.find(p => p.id === v.patientId);
        return { ...v, patientName: p ? `${p.firstName} ${p.lastName}` : "—" };
      })
    );
  };

  const handlePrint = (c: Consultation) => {
    setPrintDialog(c);
    setTimeout(() => window.print(), 300);
  };

  const selPat = patients.find(p => p.id?.toString() === form.patientId);
  const hasFatal = hasFatalAllergy(selPat);

  // Auto-BMI
  const handleWeightHeight = (field: "weight" | "height", val: string) => {
    setForm(f => {
      const w = field === "weight" ? parseFloat(val) : parseFloat(f.weight);
      const h = field === "height" ? parseFloat(val) : parseFloat(f.height);
      const bmi = computeBMI(w, h);
      return {
        ...f,
        [field]: val,
        bmi: bmi != null ? bmi.toFixed(1) : f.bmi,
        vitals: { ...f.vitals, weight: w || undefined, height: h || undefined, bmi: bmi ?? f.vitals.bmi },
      };
    });
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" />{t("consult.new")}</Button>
      </div>

      {consultations.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">{t("common.noData")}</p>
      ) : (
        <div className="grid gap-3">
          {consultations.map(c => (
            <Card key={c.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{c.patientName}</p>
                    <p className="text-xs text-muted-foreground">{t("ts.created")}: {formatDateTime(c.createdAt || c.date)}</p>
                    {c.editedAt && (
                      <p className="text-xs text-muted-foreground">{t("ts.lastEdited")}: {formatDateTime(c.editedAt)}{c.editedBy ? ` ${t("ts.by")} ${c.editedBy}` : ""}</p>
                    )}
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {c.chiefComplaint && (
                        <span className="text-xs text-muted-foreground">Motif: {c.chiefComplaint}</span>
                      )}
                      {c.versionNumber && c.versionNumber > 1 && (
                        <Badge variant="secondary" className="text-xs">v{c.versionNumber}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 no-print flex-shrink-0">
                    {(c.originalId || c.parentId) && (
                      <Button variant="ghost" size="sm" onClick={() => showHistory(c)} title={t("consult.viewVersions")}><History className="w-4 h-4" /></Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)} title={t("common.edit")}><Edit className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => exportConsultJson(c)} title={t("download.consultJson")}><Download className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handlePrint(c)} title={t("consult.print")}><Printer className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(c.id!)} className="text-destructive" title={t("common.delete")}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
                {c.diagnosis && (
                  <p className="text-sm"><span className="font-medium">{t("consult.diagnosis")}:</span> {c.diagnosis}</p>
                )}
                {c.treatmentPlan && (
                  <p className="text-sm"><span className="font-medium">{t("consult.treatment")}:</span> {c.treatmentPlan}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Consultation dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) closeDialog(); }}>
        <DialogContent className="w-full h-[100dvh] max-w-none rounded-none p-4 sm:p-6 sm:h-auto sm:max-w-3xl sm:max-h-[90vh] sm:rounded-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Stethoscope className="w-5 h-5" />
              {editingId ? t("consult.edit") : t("consult.new")}
              {consultNumber && <span className="text-xs font-mono text-muted-foreground">{consultNumber}</span>}
            </DialogTitle>
          </DialogHeader>

          {hasFatal && (
            <div className="bg-destructive text-destructive-foreground rounded-md px-3 py-2 flex items-center gap-2 font-bold text-sm">
              <AlertTri className="w-4 h-4" /> {t("ant.fatalWarning")}
              {selPat?.antecedents?.allergies?.filter(a => a.severity === "fatal").map(a => a.name).join(", ") &&
                <span className="font-normal">— {selPat!.antecedents!.allergies!.filter(a => a.severity === "fatal").map(a => a.name).join(", ")}</span>}
            </div>
          )}

          <div className="space-y-3">

            {/* ─ Section 1: Identification ─ */}
            <Section num={1} title="Identification" complete={!!form.patientId} defaultOpen={true}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("apt.patient")} *</Label>
                  <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))} disabled={!!editingId}>
                    <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
                    <SelectContent>
                      {patients.map(p => (
                        <SelectItem key={p.id} value={p.id!.toString()}>{joinFullName(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("obs.specialty")}</Label>
                  <Select value={form.specialty} onValueChange={v => setForm(f => ({ ...f, specialty: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SPECIALTIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {selPat && (
                <div className="grid grid-cols-3 gap-2 text-xs bg-muted/30 rounded-md p-3">
                  <div><span className="text-muted-foreground">Code: </span>{selPat.anonCode || "—"}</div>
                  <div><span className="text-muted-foreground">Âge: </span>{ageFromDob(selPat.dob) ?? selPat.ageYears ?? "?"} ans</div>
                  <div><span className="text-muted-foreground">Médecin: </span>{user?.name}</div>
                </div>
              )}
              <div>
                <Label>{t("consult.type")}</Label>
                <Select value={form.consultType} onValueChange={v => setForm(f => ({ ...f, consultType: v as ConsultationType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">{t("consult.type.general")}</SelectItem>
                    <SelectItem value="dental">{t("consult.type.dental")}</SelectItem>
                    <SelectItem value="orthodontic">{t("consult.type.orthodontic")}</SelectItem>
                    <SelectItem value="other">{t("consult.type.other")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Section>

            {/* ─ Section 2: Anamnèse ─ */}
            <Section num={2} title="Anamnèse" complete={!!form.chiefComplaint}>
              <VoiceTextarea
                label="Motif de consultation (Chief complaint)"
                field="chiefComplaint"
                form={form}
                setForm={setForm}
                rows={2}
                placeholder="Ex: douleur dentaire, saignement des gencives..."
                required
              />
              <VoiceTextarea
                label="Histoire de la maladie actuelle (HPI)"
                field="historyOfPresentIllness"
                form={form}
                setForm={setForm}
                rows={3}
                placeholder="Description chronologique, début, évolution, facteurs aggravants/soulageants..."
              />
              <VoiceTextarea
                label="Antécédents médicaux"
                field="medicalHistory"
                form={form}
                setForm={setForm}
                rows={3}
                placeholder="Maladies chroniques, chirurgies, traitements en cours, allergies..."
              />
              <VoiceTextarea
                label="Antécédents dentaires"
                field="dentalHistory"
                form={form}
                setForm={setForm}
                rows={3}
                placeholder="Traitements dentaires antérieurs, appareillages, extractions..."
              />
              <VoiceTextarea
                label="Revue des systèmes (optionnel)"
                field="reviewOfSystems"
                form={form}
                setForm={setForm}
                rows={2}
                placeholder="Symptômes associés par appareil..."
              />
            </Section>

            {/* ─ Section 3: Examen physique général ─ */}
            <Section num={3} title="Examen physique général" complete={!!form.generalExam || !!form.vitals.bp}>
              <VoiceTextarea
                label="Examen général"
                field="generalExam"
                form={form}
                setForm={setForm}
                rows={3}
                placeholder="État général, conscience, aspect, coloration..."
              />

              {/* Vital signs */}
              <div className="border rounded-md p-3 space-y-2">
                <Label className="text-sm font-semibold">{t("vit.title")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "bp", label: t("vit.bp"), placeholder: "120/80", type: "text" },
                    { key: "pulse", label: t("vit.pulse"), placeholder: "72", type: "number" },
                    { key: "temperature", label: t("vit.temp"), placeholder: "37.0", type: "number" },
                    { key: "respRate", label: t("vit.rr"), placeholder: "16", type: "number" },
                  ].map(({ key, label, placeholder, type }) => {
                    const alertClass = (() => {
                      const v = (form.vitals as any)[key];
                      if (!v) return "";
                      if (key === "temperature" && v > 38.5) return "border-red-400";
                      if (key === "pulse" && (v < 50 || v > 120)) return "border-orange-400";
                      if (key === "respRate" && (v < 12 || v > 25)) return "border-orange-400";
                      return "";
                    })();
                    return (
                      <div key={key}>
                        <Label className="text-[10px]">{label}</Label>
                        <Input
                          type={type}
                          className={alertClass}
                          placeholder={placeholder}
                          value={(form.vitals as any)[key] ?? ""}
                          onChange={e => {
                            const val = type === "text" ? e.target.value : (e.target.value ? parseFloat(e.target.value) : undefined);
                            setForm(f => ({ ...f, vitals: { ...f.vitals, [key]: val } }));
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Anthropometric */}
              <div className="border rounded-md p-3 space-y-2">
                <Label className="text-sm font-semibold">Paramètres anthropométriques</Label>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[10px]">{t("vit.weight")} (kg)</Label>
                    <Input type="number" placeholder="70" value={form.weight}
                      onChange={e => handleWeightHeight("weight", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-[10px]">{t("vit.height")} (cm)</Label>
                    <Input type="number" placeholder="170" value={form.height}
                      onChange={e => handleWeightHeight("height", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-[10px]">{t("vit.bmi")}</Label>
                    <Input value={form.bmi} readOnly className="bg-muted" placeholder="Auto" />
                  </div>
                </div>
              </div>
            </Section>

            {/* ─ Section 4: Examen dentaire ─ */}
            <Section num={4} title="Examen dentaire" complete={!!form.oralFindings || form.caries || form.missingTeeth}>
              <VoiceTextarea
                label="Constatations orales (Oral findings)"
                field="oralFindings"
                form={form}
                setForm={setForm}
                rows={3}
                placeholder="Description des constatations bucco-dentaires..."
              />
              <div>
                <Label className="text-sm font-semibold mb-2 block">Constatations cliniques</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {([
                    { key: "caries", label: "Caries" },
                    { key: "missingTeeth", label: "Dents manquantes" },
                    { key: "mobility", label: "Mobilité" },
                    { key: "pocketDepth", label: "Profondeur de poche" },
                    { key: "prosthetics", label: "Prothèses" },
                    { key: "orthodonticAppliances", label: "Appareillages ortho" },
                  ] as { key: keyof ConsultForm; label: string }[]).map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={!!(form[key])}
                        onCheckedChange={v => setForm(f => ({ ...f, [key]: !!v }))}
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </Section>

            {/* ─ Section 5: Assessment & Plan ─ */}
            <Section num={5} title="Assessment & Plan" complete={!!form.diagnosis}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label>Diagnostic *</Label>
                  <MicBtn field="diagnosis" form={form} setForm={setForm} />
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs ml-auto gap-1"
                    onClick={() => setDxOpen(true)}>
                    <Stethoscope className="w-3 h-3" />Base de diagnostics
                  </Button>
                </div>
                <Textarea
                  rows={3}
                  value={form.diagnosis}
                  onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))}
                  placeholder="Diagnostic principal et différentiels..."
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label>Plan de traitement</Label>
                  <MicBtn field="treatmentPlan" form={form} setForm={setForm} />
                </div>
                <Textarea
                  rows={3}
                  value={form.treatmentPlan}
                  onChange={e => setForm(f => ({ ...f, treatmentPlan: e.target.value }))}
                  placeholder="Actes à réaliser, orientation, suivi..."
                />
              </div>
              <div>
                <Label>{t("consult.prescription")}</Label>
                <Textarea
                  rows={3}
                  value={form.prescription}
                  onChange={e => setForm(f => ({ ...f, prescription: e.target.value }))}
                  placeholder="Médicament — dose — fréquence — durée"
                />
              </div>
              <div>
                <Label>{t("consult.notes")}</Label>
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Notes complémentaires..."
                />
              </div>
            </Section>

            {/* ─ Images ─ */}
            <Section num={0} title={`${t("doc.images")} (${form.images.length})`} complete={form.images.length > 0}>
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="button" size="sm" variant="outline" disabled={!canPair} onClick={pairSelected} title={t("img.pairHint")}>
                  <GitCompareArrows className="w-4 h-4 mr-1" />{t("img.pair")}
                </Button>
                <Button asChild size="sm" variant="outline" type="button">
                  <label className="cursor-pointer">
                    <Upload className="w-4 h-4 mr-2" />{t("doc.addImages")}
                    <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => handleAddImages(e)} />
                  </label>
                </Button>
                <Button asChild type="button" variant="default" size="sm" className="gap-2">
                  <label className="cursor-pointer">
                    <GitCompareArrows className="w-4 h-4" />{t("ba.add")}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={e => handleAddImages(e, "before")} />
                  </label>
                </Button>
              </div>
              {form.images.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                  {form.images.map(img => {
                    const selected = selectedImgIds.includes(img.id);
                    const isPdf = img.filename.toLowerCase().endsWith(".pdf") || img.data.startsWith("data:application/pdf");
                    return (
                      <div key={img.id} className={`relative rounded border p-2 space-y-2 ${selected ? "border-primary ring-2 ring-primary/30" : ""}`}>
                        <button type="button" className="block w-full aspect-square rounded overflow-hidden bg-muted" onClick={() => toggleSelect(img.id)}>
                          {isPdf ? (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">PDF</div>
                          ) : (
                            <img src={img.data} alt={img.filename} className="w-full h-full object-cover" />
                          )}
                        </button>
                        <div className="flex flex-wrap items-center gap-1">
                          {img.pairedWith && <Badge variant="secondary">{t("img.paired")}</Badge>}
                        </div>
                        <Select value={img.imgType ?? "other"} onValueChange={v => updateImgType(img.id, v as ConsultationImageType)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="before">{t("img.type.before")}</SelectItem>
                            <SelectItem value="after">{t("img.type.after")}</SelectItem>
                            <SelectItem value="other">{t("img.type.other")}</SelectItem>
                            <SelectItem value="annotation">{t("img.type.annotation")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input className="h-7 text-xs" placeholder={t("doc.caption")} value={img.caption || ""} onChange={e => updateCaption(img.id, e.target.value)} />
                        <div className="flex flex-wrap gap-1">
                          {!isPdf && (
                            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAnnotateImg(img)}>
                              <Pencil className="w-3 h-3 mr-1" />{t("img.annotate")}
                            </Button>
                          )}
                          {img.pairedWith && (
                            <>
                              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openCompare(img)}>
                                <GitCompareArrows className="w-3 h-3 mr-1" />{t("img.compare")}
                              </Button>
                              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => unpair(img.id)}>
                                {t("img.unpair")}
                              </Button>
                            </>
                          )}
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs ml-auto text-destructive" onClick={() => removeImage(img.id)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => {
              try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); toast.success(t("obs.autosaved")); } catch { /* */ }
            }} className="gap-1"><Save className="w-4 h-4" />Brouillon</Button>
            <Button variant="outline" onClick={closeDialog}>{t("common.cancel")}</Button>
            <Button onClick={save} disabled={!form.patientId}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Annotation modal ── */}
      <AnnotateImageModal open={!!annotateImg} src={annotateImg?.data ?? null} onClose={() => setAnnotateImg(null)} onSave={saveAnnotation} />

      {/* ── Compare dialog ── */}
      <Dialog open={!!compareDialog} onOpenChange={() => setCompareDialog(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{t("img.compare")}</DialogTitle></DialogHeader>
          {compareDialog && (
            <BeforeAfterCompare before={compareDialog.before.data} after={compareDialog.after.data} beforeLabel={t("img.type.before")} afterLabel={t("img.type.after")} />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("consult.confirmDelete")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />{t("consult.deleteWarning")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Version history ── */}
      <Dialog open={historyDialog !== null} onOpenChange={() => setHistoryDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("consult.history")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {historyDialog?.map(v => (
              <Card key={v.id} className={v.isLatest ? "border-primary" : "opacity-70"}>
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={v.isLatest ? "default" : "secondary"}>
                      {v.versionNumber ? `${t("consult.version")} ${v.versionNumber}` : (v.isLatest ? t("consult.currentVersion") : t("consult.olderVersion"))}
                    </Badge>
                    <Badge variant="outline">{!v.parentId ? t("consult.original") : t("consult.revision")}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(v.date).toLocaleString()}</span>
                    {v.editedBy && <span className="text-xs text-muted-foreground">• {t("consult.editedBy")}: {v.editedBy}</span>}
                  </div>
                  {v.chiefComplaint && <p className="text-sm"><strong>Motif:</strong> {v.chiefComplaint}</p>}
                  {v.diagnosis && <p className="text-sm"><strong>{t("consult.diagnosis")}:</strong> {v.diagnosis}</p>}
                  {v.treatmentPlan && <p className="text-sm"><strong>{t("consult.treatment")}:</strong> {v.treatmentPlan}</p>}
                  {v.prescription && <p className="text-sm"><strong>{t("consult.prescription")}:</strong> {v.prescription}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Print ── */}
      {printDialog && (
        <div className="hidden print:block p-8">
          <h1 className="text-xl font-bold mb-1">DivineLink — {t("consult.prescription")}</h1>
          <p className="text-sm mb-4">{new Date(printDialog.date).toLocaleDateString()}</p>
          <p><strong>Motif:</strong> {printDialog.chiefComplaint || printDialog.symptoms}</p>
          <p><strong>{t("consult.diagnosis")}:</strong> {printDialog.diagnosis}</p>
          <p><strong>{t("consult.treatment")}:</strong> {printDialog.treatmentPlan}</p>
          <div className="mt-4 border-t pt-4">
            <h2 className="font-bold mb-2">{t("consult.prescription")}</h2>
            <p className="whitespace-pre-wrap">{printDialog.prescription}</p>
          </div>
          <div className="mt-12 text-right"><p>____________________________</p><p className="text-sm">{t("apt.doctor")}</p></div>
        </div>
      )}

      {/* ── Image preview ── */}
      <Dialog open={!!previewImg} onOpenChange={() => setPreviewImg(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{previewImg?.filename}</DialogTitle></DialogHeader>
          {previewImg && (<><img src={previewImg.data} alt={previewImg.filename} className="w-full rounded" />{previewImg.caption && <p className="text-sm text-muted-foreground mt-2">{previewImg.caption}</p>}</>)}
        </DialogContent>
      </Dialog>

      {/* ── Inline differential diagnosis picker ── */}
      <Dialog open={dxOpen} onOpenChange={setDxOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("consult.differentials")}</DialogTitle></DialogHeader>
          <DifferentialPicker onSelect={dx => {
            setForm(f => ({ ...f, diagnosis: f.diagnosis ? `${f.diagnosis}, ${dx}` : dx }));
            setDxOpen(false);
            toast.success(t("dx.savedToConsult"));
          }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Inline differential picker ─────────────────────────────────────────────

function DifferentialPicker({ onSelect }: { onSelect: (dx: string) => void }) {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const diseaseDb = useMemo(() => {
    try { const raw = localStorage.getItem("divinelink.diseaseDb"); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  }, []);

  const allDiseases = useMemo(() => {
    const out: { name: string; system: string; symptoms: string[] }[] = [];
    Object.entries(diseaseDb).forEach(([system, diseases]: [string, unknown]) => {
      if (Array.isArray(diseases)) diseases.forEach((d: { name?: string; symptoms?: string[] } | string) => {
        const name = typeof d === "string" ? d : d.name || "";
        const symptoms = typeof d === "object" && d.symptoms ? d.symptoms : [];
        out.push({ name, system, symptoms });
      });
    });
    return out;
  }, [diseaseDb]);

  const filtered = search.trim()
    ? allDiseases.filter(d => d.name.toLowerCase().includes(search.toLowerCase()) || d.symptoms?.some(s => s.toLowerCase().includes(search.toLowerCase())))
    : allDiseases;

  return (
    <div className="space-y-3">
      <Input placeholder={t("common.search")} value={search} onChange={e => setSearch(e.target.value)} autoFocus />
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">{t("dx.noMatches")}</p>
      ) : (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {filtered.slice(0, 20).map(d => (
            <button key={d.name} onClick={() => onSelect(d.name)} className="w-full text-left p-2 rounded-md hover:bg-accent text-sm transition-colors">
              <span className="font-medium">{d.name}</span>
              {d.system && <span className="text-xs text-muted-foreground ml-2">({d.system})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
