import React, { useEffect, useState, useRef, useCallback } from "react";
import { db, type Patient, type Consultation, type DocGenType, type Payment } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Download, Share2, Plus, Trash2, PenLine, Printer } from "lucide-react";
import { toast } from "sonner";
import { decryptPatients } from "@/lib/patientCrypto";
import { joinFullName, ageFromDob } from "@/lib/patientHelpers";
import { getClinicSettings } from "@/lib/clinicSettings";

/* Auto-numbering */
async function nextNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.generatedDocs.count();
  return `${prefix}-${year}-${String(count + 1).padStart(3, "0")}`;
}

/* Clinic header for documents */
function clinicHeader(): string {
  const s = getClinicSettings();
  return s?.name || "DivineLink";
}

/* ============ Main component ============ */
interface Props { patient: Patient; consultation?: Consultation; onClose?: () => void; }

export function DocGenPanel({ patient, consultation, onClose }: Props) {
  const { t } = useLang();
  const [tab, setTab] = useState("prescription");

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="prescription">{t("docgen.prescription")}</TabsTrigger>
          <TabsTrigger value="certMedical">{t("docgen.certMedical")}</TabsTrigger>
          <TabsTrigger value="certRest">{t("docgen.certRest")}</TabsTrigger>
          <TabsTrigger value="certAptitude">{t("docgen.certAptitude")}</TabsTrigger>
          <TabsTrigger value="referral">{t("docgen.referral")}</TabsTrigger>
          <TabsTrigger value="consent">{t("docgen.consent")}</TabsTrigger>
          <TabsTrigger value="export">{t("docgen.export")}</TabsTrigger>
        </TabsList>
        <TabsContent value="prescription"><PrescriptionGen patient={patient} consultation={consultation} /></TabsContent>
        <TabsContent value="certMedical"><CertificateGen patient={patient} type="cert_medical" /></TabsContent>
        <TabsContent value="certRest"><CertificateGen patient={patient} type="cert_rest" /></TabsContent>
        <TabsContent value="certAptitude"><CertificateGen patient={patient} type="cert_aptitude" /></TabsContent>
        <TabsContent value="referral"><ReferralGen patient={patient} /></TabsContent>
        <TabsContent value="consent"><ConsentGen patient={patient} /></TabsContent>
        <TabsContent value="export"><PatientExport patient={patient} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============ Prescription Generator ============ */
function PrescriptionGen({ patient, consultation }: { patient: Patient; consultation?: Consultation }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [lines, setLines] = useState<{ drug: string; dosage: string; frequency: string; duration: string }[]>(
    consultation?.prescription ? parsePrescription(consultation.prescription) : [{ drug: "", dosage: "", frequency: "", duration: "" }]
  );
  const [preview, setPreview] = useState(false);

  function parsePrescription(text: string) {
    return text.split("\n").filter(l => l.trim()).map(l => {
      const parts = l.split(/\s{2,}|\t/);
      return { drug: parts[0] || l, dosage: parts[1] || "", frequency: parts[2] || "", duration: parts[3] || "" };
    });
  }

  const addLine = () => setLines(prev => [...prev, { drug: "", dosage: "", frequency: "", duration: "" }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, j) => j !== i));
  const updateLine = (i: number, patch: Partial<typeof lines[0]>) => {
    setLines(prev => prev.map((l, j) => j === i ? { ...l, ...patch } : l));
  };

  const number = nextNumber("ORD");

  const generateText = () => {
    const header = `${clinicHeader()}\n${t("docgen.prescription")}\n${t("patient.anonCode")}: ${patient.anonCode || patient.patientId}\nDate: ${new Date().toLocaleDateString()}\n\n`;
    const body = lines.map((l, i) => `${i + 1}. ${l.drug} — ${l.dosage} — ${l.frequency} — ${l.duration}`).join("\n");
    const footer = `\n\nDr. ${user?.name || "—"}\n${new Date().toLocaleDateString()}`;
    return header + body + footer;
  };

  const saveAndShare = async (action: "download" | "whatsapp") => {
    const num = await number;
    const text = generateText();
    await db.generatedDocs.add({ type: "prescription", patientId: patient.id!, consultationId: consultation?.id, number: num, data: text, createdAt: new Date().toISOString() });

    if (action === "whatsapp" && patient.phone) {
      const phone = patient.phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${num}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    toast.success(t("common.save"));
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("docgen.prescription")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-5 gap-2 items-end">
            <div><Label className="text-[10px]">{t("docgen.drugName")}</Label><Input value={l.drug} onChange={e => updateLine(i, { drug: e.target.value })} /></div>
            <div><Label className="text-[10px]">{t("docgen.dosage")}</Label><Input value={l.dosage} onChange={e => updateLine(i, { dosage: e.target.value })} /></div>
            <div><Label className="text-[10px]">{t("docgen.frequency")}</Label><Input value={l.frequency} onChange={e => updateLine(i, { frequency: e.target.value })} /></div>
            <div><Label className="text-[10px]">{t("docgen.duration")}</Label><Input value={l.duration} onChange={e => updateLine(i, { duration: e.target.value })} /></div>
            <Button variant="ghost" size="icon" className="text-destructive h-9 w-9" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addLine} className="gap-2"><Plus className="w-4 h-4" />{t("docgen.addLine")}</Button>

        {preview && <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap font-mono">{generateText()}</pre>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPreview(p => !p)}>{t("docgen.preview")}</Button>
          <Button onClick={() => saveAndShare("download")} className="gap-2"><Download className="w-4 h-4" />{t("docgen.downloadPdf")}</Button>
          <Button variant="secondary" onClick={() => saveAndShare("whatsapp")} className="gap-2"><Share2 className="w-4 h-4" />{t("docgen.shareWhatsApp")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============ Certificate Generator ============ */
function CertificateGen({ patient, type }: { patient: Patient; type: "cert_medical" | "cert_rest" | "cert_aptitude" }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [restDays, setRestDays] = useState("3");
  const [content, setContent] = useState("");

  const number = nextNumber("CERT");

  const generateText = () => {
    const header = `${clinicHeader()}\n`;
    const id = `${t("patient.anonCode")}: ${patient.anonCode || patient.patientId}`;
    const date = `Date: ${new Date().toLocaleDateString()}`;
    const doctor = `Dr. ${user?.name || "—"}`;

    if (type === "cert_medical") return `${header}${t("docgen.certMedical")}\n${id}\n${date}\n\nJe soussigné ${doctor}, certifie que le patient portant le code ${patient.anonCode || patient.patientId} a été examiné ce jour.\n\n${content}\n\n${doctor}\n${date}`;
    if (type === "cert_rest") return `${header}${t("docgen.certRest")}\n${id}\n${date}\n\nJe soussigné ${doctor}, certifie que le patient portant le code ${patient.anonCode || patient.patientId} nécessite ${restDays} jours de repos.\n\n${content}\n\n${doctor}\n${date}`;
    return `${header}${t("docgen.certAptitude")}\n${id}\n${date}\n\nJe soussigné ${doctor}, certifie que le patient portant le code ${patient.anonCode || patient.patientId} est apte.\n\n${content}\n\n${doctor}\n${date}`;
  };

  const saveAndShare = async (action: "download" | "whatsapp") => {
    const num = await number;
    const text = generateText();
    await db.generatedDocs.add({ type, patientId: patient.id!, number: num, data: text, createdAt: new Date().toISOString() });
    if (action === "whatsapp" && patient.phone) {
      const phone = patient.phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${num}.txt`; a.click(); URL.revokeObjectURL(a.href);
    }
    toast.success(t("common.save"));
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t(`docgen.${type === "cert_medical" ? "certMedical" : type === "cert_rest" ? "certRest" : "certAptitude"}`)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {type === "cert_rest" && (
          <div><Label>{t("docgen.restDays")}</Label><Input type="number" value={restDays} onChange={e => setRestDays(e.target.value)} /></div>
        )}
        <div><Label>{t("consult.notes")}</Label><Textarea value={content} onChange={e => setContent(e.target.value)} /></div>
        <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap font-mono">{generateText()}</pre>
        <div className="flex gap-2">
          <Button onClick={() => saveAndShare("download")} className="gap-2"><Download className="w-4 h-4" />{t("docgen.downloadPdf")}</Button>
          <Button variant="secondary" onClick={() => saveAndShare("whatsapp")} className="gap-2"><Share2 className="w-4 h-4" />{t("docgen.shareWhatsApp")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============ Referral Letter ============ */
function ReferralGen({ patient }: { patient: Patient }) {
  const { t } = useLang();
  const { user } = useAuth();

  const text = `${clinicHeader()}\n${t("docgen.referral")}\n${t("patient.anonCode")}: ${patient.anonCode || patient.patientId}\nDate: ${new Date().toLocaleDateString()}\n\nCher confrère,\n\nJe vous adresse le patient portant le code ${patient.anonCode || patient.patientId}.\n\nAntécédents: ${patient.antecedents?.chronicDiseases?.join(", ") || "—"}\nAllergies: ${patient.antecedents?.allergies?.map(a => `${a.name} (${a.severity})`).join(", ") || "—"}\nAlertes: ${patient.medicalAlerts || "—"}\n\nCordialement,\nDr. ${user?.name || "—"}`;

  const saveAndShare = async (action: "download" | "whatsapp") => {
    const num = await nextNumber("REF");
    await db.generatedDocs.add({ type: "referral", patientId: patient.id!, number: num, data: text, createdAt: new Date().toISOString() });
    if (action === "whatsapp" && patient.phone) {
      const phone = patient.phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${num}.txt`; a.click(); URL.revokeObjectURL(a.href);
    }
    toast.success(t("common.save"));
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("docgen.referral")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap font-mono">{text}</pre>
        <div className="flex gap-2">
          <Button onClick={() => saveAndShare("download")} className="gap-2"><Download className="w-4 h-4" />{t("docgen.downloadPdf")}</Button>
          <Button variant="secondary" onClick={() => saveAndShare("whatsapp")} className="gap-2"><Share2 className="w-4 h-4" />{t("docgen.shareWhatsApp")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============ Digital Consent ============ */
function ConsentGen({ patient }: { patient: Patient }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [procedure, setProcedure] = useState("");
  const [consentText, setConsentText] = useState("");
  const patientCanvasRef = useRef<HTMLCanvasElement>(null);
  const doctorCanvasRef = useRef<HTMLCanvasElement>(null);
  const [patientDrawing, setPatientDrawing] = useState(false);
  const [doctorDrawing, setDoctorDrawing] = useState(false);

  const setupCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  };

  useEffect(() => { setupCanvas(patientCanvasRef.current); setupCanvas(doctorCanvasRef.current); }, []);

  const startDraw = (canvas: HTMLCanvasElement | null, setDrawing: (v: boolean) => void, e: React.MouseEvent | React.TouchEvent) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = ("touches" in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ("touches" in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (canvas: HTMLCanvasElement | null, drawing: boolean, e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ("touches" in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ("touches" in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const save = async () => {
    const patientSig = patientCanvasRef.current?.toDataURL() || "";
    const doctorSig = doctorCanvasRef.current?.toDataURL() || "";
    const num = await nextNumber("CONS");
    const text = `${clinicHeader()}\n${t("docgen.consent")}\n${t("patient.anonCode")}: ${patient.anonCode || patient.patientId}\nDate: ${new Date().toLocaleDateString()}\n\n${t("docgen.procedure")}: ${procedure}\n\n${consentText}\n\nPatient: [signature]\nDocteur: Dr. ${user?.name || "—"} [signature]`;
    await db.generatedDocs.add({ type: "consent", patientId: patient.id!, number: num, data: JSON.stringify({ text, patientSig, doctorSig }), createdAt: new Date().toISOString() });
    toast.success(t("common.save"));
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("docgen.consent")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div><Label>{t("docgen.procedure")}</Label><Input value={procedure} onChange={e => setProcedure(e.target.value)} /></div>
        <div><Label>{t("docgen.consentText")}</Label><Textarea value={consentText} onChange={e => setConsentText(e.target.value)} rows={4} /></div>

        <div>
          <Label>{t("docgen.patientSign")}</Label>
          <canvas ref={patientCanvasRef} width={300} height={80} className="border rounded w-full max-w-[300px] touch-none"
            onMouseDown={e => startDraw(patientCanvasRef.current, setPatientDrawing, e)}
            onMouseMove={e => draw(patientCanvasRef.current, patientDrawing, e)}
            onMouseUp={() => setPatientDrawing(false)}
            onTouchStart={e => startDraw(patientCanvasRef.current, setPatientDrawing, e)}
            onTouchMove={e => draw(patientCanvasRef.current, patientDrawing, e)}
            onTouchEnd={() => setPatientDrawing(false)}
          />
          <Button variant="ghost" size="sm" onClick={() => setupCanvas(patientCanvasRef.current)}>{t("docgen.clearSign")}</Button>
        </div>

        <div>
          <Label>{t("docgen.doctorSign")}</Label>
          <canvas ref={doctorCanvasRef} width={300} height={80} className="border rounded w-full max-w-[300px] touch-none"
            onMouseDown={e => startDraw(doctorCanvasRef.current, setDoctorDrawing, e)}
            onMouseMove={e => draw(doctorCanvasRef.current, doctorDrawing, e)}
            onMouseUp={() => setDoctorDrawing(false)}
            onTouchStart={e => startDraw(doctorCanvasRef.current, setDoctorDrawing, e)}
            onTouchMove={e => draw(doctorCanvasRef.current, doctorDrawing, e)}
            onTouchEnd={() => setDoctorDrawing(false)}
          />
          <Button variant="ghost" size="sm" onClick={() => setupCanvas(doctorCanvasRef.current)}>{t("docgen.clearSign")}</Button>
        </div>

        <Button onClick={save} className="gap-2"><FileText className="w-4 h-4" />{t("common.save")}</Button>
      </CardContent>
    </Card>
  );
}

/* ============ Patient File Export ============ */
function PatientExport({ patient }: { patient: Patient }) {
  const { t } = useLang();
  const [include, setInclude] = useState({
    anonInfo: true, antecedents: true, vitals: true,
    consultations: true, dental: true, prescriptions: true, payments: true,
  });

  const toggle = (key: keyof typeof include) => setInclude(prev => ({ ...prev, [key]: !prev[key] }));

  const exportFile = async () => {
    const sections: string[] = [];
    const header = `${clinicHeader()}\nDossier patient\n${t("patient.anonCode")}: ${patient.anonCode || patient.patientId}\nDate: ${new Date().toLocaleDateString()}\n\n`;

    if (include.anonInfo) {
      sections.push(`--- ${t("docgen.anonInfo")} ---\nCode: ${patient.anonCode || patient.patientId}\nÂge: ${ageFromDob(patient.dob) ?? patient.ageYears ?? "—"} ans\nTéléphone: ${patient.phone || "—"}`);
    }
    if (include.antecedents && patient.antecedents) {
      const a = patient.antecedents;
      sections.push(`--- ${t("docgen.antecedents")} ---\nAllergies: ${a.allergies?.map(al => `${al.name} (${al.severity})`).join(", ") || "—"}\nChroniques: ${a.chronicDiseases?.join(", ") || "—"}\nDiabétique: ${a.diabetic ? "Oui" : "Non"}\nHypertendu: ${a.hypertensive ? "Oui" : "Non"}\nFumeur: ${a.smoker ? "Oui" : "Non"}`);
    }
    if (include.consultations) {
      const cons = await db.consultations.where("patientId").equals(patient.id!).toArray();
      const latest = cons.filter(c => c.isLatest !== false);
      if (latest.length) {
        sections.push(`--- ${t("tab.consultations")} ---\n` + latest.map(c => `Date: ${new Date(c.date).toLocaleDateString()}\nDiagnostic: ${c.diagnosis || "—"}\nTraitement: ${c.treatmentPlan || "—"}`).join("\n\n"));
      }
    }
    if (include.payments) {
      const pays = await db.payments.where("patientId").equals(patient.id!).toArray();
      if (pays.length) {
        sections.push(`--- ${t("tab.payments")} ---\n` + pays.map(p => `Date: ${new Date(p.createdAt).toLocaleDateString()}\nMontant: ${p.amountPaid}/${p.amountDue} FCFA (${p.status})`).join("\n\n"));
      }
    }

    const text = header + sections.join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Dossier-${patient.anonCode || patient.patientId}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(t("download.done"));
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("docgen.export")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(include) as (keyof typeof include)[]).map(key => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={include[key]} onCheckedChange={() => toggle(key)} />
              <span className="text-sm">{t(`docgen.${key}`)}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={exportFile} className="gap-2"><Download className="w-4 h-4" />{t("docgen.downloadPdf")}</Button>
          {patient.phone && (
            <Button variant="secondary" onClick={async () => { await exportFile(); }} className="gap-2"><Share2 className="w-4 h-4" />{t("docgen.shareWhatsApp")}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
