import React, { useEffect, useMemo, useState } from "react";
import {
  db,
  type Patient,
  type Allergy,
  type AllergySeverity,
  type Vaccination,
  type Antecedents,
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
  type Consultation,
  type Document as DocRow,
  type Appointment,
} from "@/lib/db";
import { useLang } from "@/contexts/LangContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, TriangleAlert as AlertTriangle, FileText, Calendar, Stethoscope, CreditCard, FileOutput, ChartBar as BarChart3, X } from "lucide-react";
import { toast } from "sonner";
import {
  joinFullName, splitFullName, ageFromDob, dobFromAge,
  paymentBalance, paymentBadgeEmoji, patientPaymentSummary,
} from "@/lib/patientHelpers";
import { decryptPatient, encryptPatientForSave } from "@/lib/patientCrypto";
import { DocGenPanel } from "@/components/DocGenPanel";
import { AIClinicalAssistant, AIButton } from "@/components/AIClinicalAssistant";
import { VitalSignsTrends } from "@/components/VitalSignsTrends";
import { ImportedDocumentsTab } from "@/components/ImportedDocumentsTab";

interface Props {
  patient: Patient;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

const SEVERITY_COLORS: Record<AllergySeverity, string> = {
  mild: "bg-secondary text-secondary-foreground",
  moderate: "bg-warning text-warning-foreground",
  severe: "bg-destructive text-destructive-foreground",
  fatal: "bg-destructive text-destructive-foreground ring-2 ring-destructive",
};

/* ---------------- Patient Intelligence Banner ---------------- */
function PatientIntelligenceBanner({ patientId }: { patientId: number }) {
  const { t } = useLang();
  const [daysSince, setDaysSince] = useState<number | null>(null);
  const [totalVisits, setTotalVisits] = useState(0);
  const [topDiagnosis, setTopDiagnosis] = useState("");
  const [unpaidBalance, setUnpaidBalance] = useState(0);

  useEffect(() => {
    (async () => {
      const consultations = await db.consultations.where("patientId").equals(patientId).toArray();
      const latest = consultations.filter(c => c.isLatest !== false);
      setTotalVisits(latest.length);

      if (latest.length > 0) {
        const sorted = [...latest].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastDate = new Date(sorted[0].date);
        setDaysSince(Math.floor((Date.now() - lastDate.getTime()) / 86400000));

        const diagCounts: Record<string, number> = {};
        latest.forEach(c => {
          if (c.diagnosis) {
            const d = c.diagnosis.trim();
            if (d) diagCounts[d] = (diagCounts[d] || 0) + 1;
          }
        });
        const top = Object.entries(diagCounts).sort((a, b) => b[1] - a[1])[0];
        if (top) setTopDiagnosis(top[0]);
      } else {
        setDaysSince(null);
      }

      const payments = await db.payments.where("patientId").equals(patientId).toArray();
      const balance = payments.reduce((s, p) => s + paymentBalance(p), 0);
      setUnpaidBalance(balance);
    })();
  }, [patientId]);

  if (daysSince === null && totalVisits === 0) {
    return (
      <div className="border-l-4 border-muted bg-muted/50 rounded-r-md px-3 py-2 text-sm text-muted-foreground">
        {t("pi.noVisits")}
      </div>
    );
  }

  const borderColor = daysSince === null ? "border-muted" : daysSince < 30 ? "border-green-500" : daysSince <= 90 ? "border-orange-500" : "border-red-500";
  const daysColor = daysSince === null ? "" : daysSince < 30 ? "text-green-600" : daysSince <= 90 ? "text-orange-600" : "text-red-600";

  return (
    <div className={`border-l-4 ${borderColor} bg-accent/50 rounded-r-md px-3 py-2`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        {daysSince !== null && (
          <span className="flex items-center gap-1.5">
            <span className={`font-bold text-lg ${daysColor}`}>{daysSince}</span>
            <span className="text-muted-foreground">{t("pi.daysSince")}</span>
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="font-bold text-lg">{totalVisits}</span>
          <span className="text-muted-foreground">{t("pi.visits")}</span>
        </span>
        {topDiagnosis && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t("pi.topDiagnosis")}:</span>
            <span className="font-medium">{topDiagnosis}</span>
          </span>
        )}
        {unpaidBalance > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t("pi.unpaid")}:</span>
            <span className="font-bold text-red-600">{unpaidBalance.toFixed(0)} XAF</span>
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- Patient Show Mode ---------------- */
function PatientShowMode({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const { t } = useLang();
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [nextAppt, setNextAppt] = useState<Appointment | null>(null);

  useEffect(() => {
    (async () => {
      const cons = await db.consultations.where("patientId").equals(patient.id!).toArray();
      const latest = cons.filter(c => c.isLatest !== false).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setConsultations(latest);

      const now = new Date().toISOString().split("T")[0];
      const apts = await db.appointments
        .where("patientId").equals(patient.id!)
        .filter(a => a.date >= now && a.status !== "cancelled" && a.status !== "noshow")
        .sortBy("date");
      setNextAppt(apts[0] || null);
    })();
  }, [patient.id]);

  const clinicName = localStorage.getItem("divinelink.clinicName") || "DivineLink";
  const patientName = joinFullName(patient);

  const dentalConsults = consultations.filter(c => c.consultType === "dental" && c.dental?.teeth?.length);
  const consultsWithVitals = consultations.filter(c => c.vitals).slice(0, 5);

  const dentalConditionLabels: Record<string, string> = {
    healthy: t("dental.healthy"), decayed: t("dental.decayed"), missing: t("dental.missing"),
    crowned: t("dental.crowned"), filled: t("dental.filled"), fractured: t("dental.fractured"),
    to_extract: t("dental.to_extract"), mobile: t("dental.mobile"),
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto" style={{ animation: "fadeIn 0.4s ease-out" }}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
      {/* Background */}
      <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #fdf6ee 0%, #f0f7f4 50%, #fef9f0 100%)" }}>

        {/* Exit button */}
        <button
          onClick={onClose}
          className="fixed top-4 right-4 z-[101] flex items-center gap-2 rounded-full bg-white/90 shadow-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white transition-colors"
        >
          <X className="w-5 h-5" /> {t("show.exit")}
        </button>

        <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

          {/* Welcome header */}
          <div className="text-center space-y-2">
            <p className="text-lg text-amber-700 font-medium tracking-wide">{clinicName}</p>
            <h1 className="text-3xl font-bold text-gray-800">{t("show.welcome")}</h1>
            <h2 className="text-2xl text-gray-700 font-semibold">{patientName}</h2>
          </div>

          {/* Next appointment */}
          <Card title={t("show.nextAppt")}>
            {nextAppt ? (
              <div className="flex items-center gap-4 text-lg">
                <Calendar className="w-6 h-6 text-teal-600" />
                <div>
                  <p className="font-semibold text-gray-800">{nextAppt.date} {nextAppt.time && ` - ${nextAppt.time}`}</p>
                  {nextAppt.reason && <p className="text-gray-600">{nextAppt.reason}</p>}
                </div>
              </div>
            ) : (
              <p className="text-lg text-gray-500">{t("show.noNextAppt")}</p>
            )}
          </Card>

          {/* Visit history timeline */}
          <Card title={t("show.visitHistory")}>
            {consultations.length === 0 ? (
              <p className="text-lg text-gray-500">{t("pi.noVisits")}</p>
            ) : (
              <div className="space-y-4">
                {consultations.map((c, i) => (
                  <div key={c.id || i} className="flex gap-4 items-start">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full bg-teal-500 mt-1.5" />
                      {i < consultations.length - 1 && <div className="w-0.5 h-8 bg-teal-200" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-gray-500">{new Date(c.date).toLocaleDateString()}</p>
                      {c.diagnosis && <p className="text-lg font-medium text-gray-800">{c.diagnosis}</p>}
                      {c.treatmentPlan && <p className="text-base text-gray-600">{c.treatmentPlan}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Dental chart */}
          {dentalConsults.length > 0 && (
            <Card title={t("show.dentalChart")}>
              <div className="flex flex-wrap gap-2">
                {dentalConsults.flatMap(c => c.dental!.teeth).map((tooth, i) => (
                  <div
                    key={i}
                    className={`flex flex-col items-center rounded-lg px-3 py-2 text-center min-w-[60px] ${
                      tooth.condition === "healthy" ? "bg-green-50 text-green-700" :
                      tooth.condition === "decayed" ? "bg-red-50 text-red-700" :
                      tooth.condition === "missing" ? "bg-gray-100 text-gray-500" :
                      tooth.condition === "crowned" ? "bg-amber-50 text-amber-700" :
                      tooth.condition === "filled" ? "bg-blue-50 text-blue-700" :
                      "bg-orange-50 text-orange-700"
                    }`}
                  >
                    <span className="text-lg font-bold">{tooth.number}</span>
                    <span className="text-xs">{dentalConditionLabels[tooth.condition] || tooth.condition}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Vitals trend chart */}
          {consultsWithVitals.length > 0 && (
            <Card title={t("show.vitals")}>
              <div className="space-y-4">
                {["pulse", "weight", "temperature"].map(key => {
                  const label = key === "pulse" ? t("vit.pulse") : key === "weight" ? t("vit.weight") : t("vit.temp");
                  const values = consultsWithVitals.map(c => {
                    const v = c.vitals!;
                    return key === "pulse" ? v.pulse : key === "weight" ? v.weight : v.temperature;
                  }).filter((v): v is number => v !== undefined);
                  if (values.length === 0) return null;
                  const max = Math.max(...values);
                  const min = Math.min(...values);
                  const range = max - min || 1;
                  return (
                    <div key={key}>
                      <p className="text-sm font-medium text-gray-600 mb-1">{label}</p>
                      <div className="flex items-end gap-2 h-20">
                        {values.map((v, i) => {
                          const pct = ((v - min) / range) * 60 + 20;
                          return (
                            <div key={i} className="flex flex-col items-center flex-1">
                              <div
                                className="w-full rounded-t bg-teal-400 min-w-[20px]"
                                style={{ height: `${pct}%` }}
                              />
                              <span className="text-xs text-gray-500 mt-1">{v}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 p-6 space-y-3">
      <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
      {children}
    </div>
  );
}

export function PatientProfile({ patient, open, onClose, onChanged }: Props) {
  const { t } = useLang();
  const [p, setP] = useState<Patient>(patient);
  const [tab, setTab] = useState("info");
  const [docGenOpen, setDocGenOpen] = useState(false);
  const [showMode, setShowMode] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => { setP(patient); }, [patient]);

  const fatal = useMemo(
    () => p.antecedents?.allergies?.some(a => a.severity === "fatal"),
    [p.antecedents],
  );

  const persistPatient = async (next: Patient) => {
    if (!next.id) return;
    const now = new Date().toISOString();
    const enc = await encryptPatientForSave(next);
    await db.patients.update(next.id, { ...enc, updatedAt: now });
    onChanged?.();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{joinFullName(p) || t("patient.profile")}</span>
            {p.anonCode && <code className="text-[10px] bg-accent px-1.5 py-0.5 rounded font-mono">{p.anonCode}</code>}
          </DialogTitle>
        </DialogHeader>

        {p.id && <PatientIntelligenceBanner patientId={p.id} />}

        {fatal && (
          <div className="bg-destructive text-destructive-foreground rounded-md px-3 py-2 flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="w-4 h-4" /> {t("ant.fatalWarning")}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowMode(true)} className="gap-2">
            <BarChart3 className="w-4 h-4" />{t("show.title")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDocGenOpen(true)} className="gap-2">
            <FileOutput className="w-4 h-4" />{t("docgen.export")}
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto w-full text-[11px] gap-0.5">
            <TabsTrigger value="info">{t("tab.info")}</TabsTrigger>
            <TabsTrigger value="ant">{t("tab.antecedents")}</TabsTrigger>
            <TabsTrigger value="cons">{t("tab.consultations")}</TabsTrigger>
            <TabsTrigger value="courbes">📈</TabsTrigger>
            <TabsTrigger value="docs">{t("tab.documents")}</TabsTrigger>
            <TabsTrigger value="imported">📄 Word</TabsTrigger>
            <TabsTrigger value="pay">{t("tab.payments")}</TabsTrigger>
            <TabsTrigger value="tl">{t("tab.timeline")}</TabsTrigger>
          </TabsList>

          <TabsContent value="info">
            <InfoTab p={p} setP={setP} onSave={persistPatient} />
          </TabsContent>
          <TabsContent value="ant">
            <AntecedentsTab p={p} setP={setP} onSave={persistPatient} />
          </TabsContent>
          <TabsContent value="cons">
            <ConsultationsTab patientId={p.id!} />
          </TabsContent>
          <TabsContent value="courbes">
            <VitalSignsTrends patientId={p.id!} />
          </TabsContent>
          <TabsContent value="docs">
            <DocumentsTab patientId={p.id!} />
          </TabsContent>
          <TabsContent value="imported">
            <ImportedDocumentsTab patientId={p.id!} />
          </TabsContent>
          <TabsContent value="pay">
            <PaymentsTab patientId={p.id!} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="tl">
            <TimelineTab patientId={p.id!} />
          </TabsContent>
        </Tabs>

        {/* Floating AI button */}
        <AIButton onClick={() => setAiOpen(true)} position="bottom-right" />

        {/* Document generation dialog */}
        <Dialog open={docGenOpen} onOpenChange={setDocGenOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t("docgen.export")}</DialogTitle></DialogHeader>
            <DocGenPanel patient={p} />
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>

    {showMode && <PatientShowMode patient={p} onClose={() => setShowMode(false)} />}
    <AIClinicalAssistant
      open={aiOpen}
      onClose={() => setAiOpen(false)}
      patientContext={{ patient: p }}
    />
    </>
  );
}

/* ---------------- Info Tab ---------------- */
function InfoTab({ p, setP, onSave }: { p: Patient; setP: (p: Patient) => void; onSave: (p: Patient) => Promise<void> }) {
  const { t } = useLang();
  const [fullName, setFullName] = useState(joinFullName(p));
  const [age, setAge] = useState<string>(p.ageYears?.toString() ?? (ageFromDob(p.dob)?.toString() ?? ""));

  useEffect(() => {
    setFullName(joinFullName(p));
    setAge(p.ageYears?.toString() ?? (ageFromDob(p.dob)?.toString() ?? ""));
  }, [p.id]);

  const save = async () => {
    const { firstName, lastName } = splitFullName(fullName);
    const ageNum = age ? parseInt(age) : undefined;
    const next: Patient = {
      ...p,
      firstName,
      lastName,
      ageYears: ageNum,
      dob: p.dob || (ageNum ? dobFromAge(ageNum) : ""),
    };
    setP(next);
    await onSave(next);
    toast.success(t("common.save"));
  };

  return (
    <div className="space-y-3 pt-3">
      <div>
        <Label>{t("patient.fullName")} *</Label>
        <Input value={fullName} onChange={e => setFullName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("patient.dob")}</Label>
          <Input type="date" value={p.dob || ""} onChange={e => {
            setP({ ...p, dob: e.target.value });
            const a = ageFromDob(e.target.value);
            if (a !== undefined) setAge(a.toString());
          }} />
        </div>
        <div>
          <Label>{t("patient.age")} ({t("patient.years")})</Label>
          <Input type="number" min={0} max={150} value={age} onChange={e => setAge(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>{t("patient.phone")}</Label>
        <Input value={p.phone || ""} onChange={e => setP({ ...p, phone: e.target.value })} />
      </div>
      <div>
        <Label>{t("patient.address")}</Label>
        <Input value={p.address || ""} onChange={e => setP({ ...p, address: e.target.value })} />
      </div>
      <div>
        <Label>{t("patient.alerts")}</Label>
        <Textarea value={p.medicalAlerts || ""} onChange={e => setP({ ...p, medicalAlerts: e.target.value })} />
      </div>
      <Button onClick={save} className="w-full">{t("common.save")}</Button>
    </div>
  );
}

/* ---------------- Antécédents Tab ---------------- */
function AntecedentsTab({ p, setP, onSave }: { p: Patient; setP: (p: Patient) => void; onSave: (p: Patient) => Promise<void> }) {
  const { t } = useLang();
  const a: Antecedents = p.antecedents || {};
  const update = (next: Antecedents) => setP({ ...p, antecedents: next });

  const addAllergy = () => update({ ...a, allergies: [...(a.allergies || []), { name: "", severity: "mild" }] });
  const updateAllergy = (i: number, patch: Partial<Allergy>) => {
    const list = [...(a.allergies || [])];
    list[i] = { ...list[i], ...patch };
    update({ ...a, allergies: list });
  };
  const removeAllergy = (i: number) => update({ ...a, allergies: (a.allergies || []).filter((_, j) => j !== i) });

  const addChronic = () => update({ ...a, chronicDiseases: [...(a.chronicDiseases || []), ""] });
  const setChronic = (i: number, v: string) => {
    const list = [...(a.chronicDiseases || [])]; list[i] = v;
    update({ ...a, chronicDiseases: list });
  };
  const removeChronic = (i: number) => update({ ...a, chronicDiseases: (a.chronicDiseases || []).filter((_, j) => j !== i) });

  const addVacc = () => update({ ...a, vaccinations: [...(a.vaccinations || []), { name: "" }] });
  const setVacc = (i: number, patch: Partial<Vaccination>) => {
    const list = [...(a.vaccinations || [])]; list[i] = { ...list[i], ...patch };
    update({ ...a, vaccinations: list });
  };
  const removeVacc = (i: number) => update({ ...a, vaccinations: (a.vaccinations || []).filter((_, j) => j !== i) });

  const save = async () => { await onSave(p); toast.success(t("common.save")); };

  return (
    <div className="space-y-4 pt-3">
      {/* Allergies */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">{t("ant.allergies")}</Label>
          <Button size="sm" variant="outline" onClick={addAllergy}><Plus className="w-3 h-3 mr-1" />{t("ant.addAllergy")}</Button>
        </div>
        {(a.allergies || []).map((al, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input placeholder={t("ant.allergyName")} value={al.name} onChange={e => updateAllergy(i, { name: e.target.value })} />
            <Select value={al.severity} onValueChange={(v: AllergySeverity) => updateAllergy(i, { severity: v })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mild">{t("ant.sev.mild")}</SelectItem>
                <SelectItem value="moderate">{t("ant.sev.moderate")}</SelectItem>
                <SelectItem value="severe">{t("ant.sev.severe")}</SelectItem>
                <SelectItem value="fatal">{t("ant.sev.fatal")}</SelectItem>
              </SelectContent>
            </Select>
            <Badge className={SEVERITY_COLORS[al.severity]}>{t(`ant.sev.${al.severity}`)}</Badge>
            <Button size="icon" variant="ghost" onClick={() => removeAllergy(i)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </section>

      {/* Chronic */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">{t("ant.chronic")}</Label>
          <Button size="sm" variant="outline" onClick={addChronic}><Plus className="w-3 h-3 mr-1" />{t("ant.addChronic")}</Button>
        </div>
        {(a.chronicDiseases || []).map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={c} onChange={e => setChronic(i, e.target.value)} />
            <Button size="icon" variant="ghost" onClick={() => removeChronic(i)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </section>

      {/* Blood + toggles */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("ant.bloodType")}</Label>
          <Select value={a.bloodType || ""} onValueChange={v => update({ ...a, bloodType: v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <ToggleRow label={t("ant.diabetic")} checked={!!a.diabetic} onChange={v => update({ ...a, diabetic: v })} />
        <ToggleRow label={t("ant.hypertensive")} checked={!!a.hypertensive} onChange={v => update({ ...a, hypertensive: v })} />
        <ToggleRow label={t("ant.smoker")} checked={!!a.smoker} onChange={v => update({ ...a, smoker: v })} />
      </div>

      {/* Vaccinations */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">{t("ant.vaccinations")}</Label>
          <Button size="sm" variant="outline" onClick={addVacc}><Plus className="w-3 h-3 mr-1" />{t("ant.addVaccination")}</Button>
        </div>
        {(a.vaccinations || []).map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input placeholder={t("ant.vaccinations")} value={v.name} onChange={e => setVacc(i, { name: e.target.value })} />
            <Input type="date" value={v.date || ""} onChange={e => setVacc(i, { date: e.target.value })} className="w-40" />
            <Button size="icon" variant="ghost" onClick={() => removeVacc(i)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </section>

      <div>
        <Label>{t("ant.familyHistory")}</Label>
        <Textarea value={a.familyHistory || ""} onChange={e => update({ ...a, familyHistory: e.target.value })} />
      </div>
      <div>
        <Label>{t("ant.surgeries")}</Label>
        <Textarea value={a.surgeries || ""} onChange={e => update({ ...a, surgeries: e.target.value })} />
      </div>

      <Button onClick={save} className="w-full">{t("common.save")}</Button>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ---------------- Consultations Tab ---------------- */
function ConsultationsTab({ patientId }: { patientId: number }) {
  const { t } = useLang();
  const [list, setList] = useState<Consultation[]>([]);
  useEffect(() => {
    db.consultations.where("patientId").equals(patientId).reverse().sortBy("date").then(setList);
  }, [patientId]);
  const latest = list.filter(c => c.isLatest !== false);
  if (!latest.length) return <p className="text-muted-foreground text-center py-6 text-sm">{t("common.noData")}</p>;
  return (
    <div className="space-y-2 pt-3">
      {latest.map(c => (
        <div key={c.id} className="border rounded-md p-3 text-sm">
          <p className="text-xs text-muted-foreground">{new Date(c.date).toLocaleString()}</p>
          {c.diagnosis && <p><span className="font-medium">{t("consult.diagnosis")}:</span> {c.diagnosis}</p>}
          {c.treatmentPlan && <p><span className="font-medium">{t("consult.treatment")}:</span> {c.treatmentPlan}</p>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Documents Tab ---------------- */
function DocumentsTab({ patientId }: { patientId: number }) {
  const { t } = useLang();
  const [list, setList] = useState<DocRow[]>([]);
  useEffect(() => {
    db.documents.where("patientId").equals(patientId).reverse().sortBy("createdAt").then(setList);
  }, [patientId]);
  if (!list.length) return <p className="text-muted-foreground text-center py-6 text-sm">{t("doc.noFiles")}</p>;
  return (
    <div className="grid grid-cols-2 gap-2 pt-3">
      {list.map(d => (
        <a key={d.id} href={d.data} download={d.name} className="border rounded-md p-2 text-xs hover:bg-accent flex items-center gap-2">
          <FileText className="w-4 h-4" /> <span className="truncate">{d.name}</span>
        </a>
      ))}
    </div>
  );
}

/* ---------------- Payments Tab ---------------- */
function PaymentsTab({ patientId, onChanged }: { patientId: number; onChanged?: () => void }) {
  const { t } = useLang();
  const [list, setList] = useState<Payment[]>([]);
  const [form, setForm] = useState<{ amountDue: string; amountPaid: string; method: PaymentMethod; status: PaymentStatus; notes: string }>(
    { amountDue: "", amountPaid: "", method: "cash", status: "unpaid", notes: "" }
  );

  const load = () => db.payments.where("patientId").equals(patientId).reverse().sortBy("createdAt").then(setList);
  useEffect(() => { load(); }, [patientId]);

  const totalBalance = list.reduce((s, p) => s + paymentBalance(p), 0);

  const add = async () => {
    const due = parseFloat(form.amountDue) || 0;
    const paid = parseFloat(form.amountPaid) || 0;
    const status: PaymentStatus = paid >= due && due > 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
    const now = new Date().toISOString();
    const cid = localStorage.getItem("divinelink.clinicId") || undefined;
    await db.payments.add({
      patientId, amountDue: due, amountPaid: paid, status, method: form.method,
      notes: form.notes || undefined, clinicId: cid, createdAt: now, updatedAt: now,
    });
    setForm({ amountDue: "", amountPaid: "", method: "cash", status: "unpaid", notes: "" });
    load();
    onChanged?.();
    toast.success(t("common.save"));
  };

  const remove = async (id: number) => {
    await db.payments.delete(id);
    load();
    onChanged?.();
  };

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t("pay.totalBalance")}</span>
        <span className={`font-bold ${totalBalance > 0 ? "text-destructive" : "text-success"}`}>{totalBalance.toFixed(0)} XAF</span>
      </div>

      {list.map(p => (
        <div key={p.id} className="border rounded-md p-3 text-sm flex items-center justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span>{paymentBadgeEmoji(p.status)}</span>
              <span className="font-medium">{p.amountPaid}/{p.amountDue} XAF</span>
              <Badge variant="outline" className="text-[10px]">{t(`pay.method.${p.method}`)}</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</p>
            {p.notes && <p className="text-xs">{p.notes}</p>}
          </div>
          <Button size="icon" variant="ghost" onClick={() => p.id && remove(p.id)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
        </div>
      ))}

      <div className="border-t pt-3 space-y-2">
        <Label className="font-semibold text-sm">{t("pay.add")}</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" placeholder={t("pay.due")} value={form.amountDue} onChange={e => setForm(f => ({ ...f, amountDue: e.target.value }))} />
          <Input type="number" placeholder={t("pay.paid")} value={form.amountPaid} onChange={e => setForm(f => ({ ...f, amountPaid: e.target.value }))} />
        </div>
        <Select value={form.method} onValueChange={(v: PaymentMethod) => setForm(f => ({ ...f, method: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">{t("pay.method.cash")}</SelectItem>
            <SelectItem value="mtn_momo">{t("pay.method.mtn_momo")}</SelectItem>
            <SelectItem value="orange_money">{t("pay.method.orange_money")}</SelectItem>
            <SelectItem value="other">{t("pay.method.other")}</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder={t("consult.notes")} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        <Button onClick={add} className="w-full"><Plus className="w-4 h-4 mr-1" />{t("pay.add")}</Button>
      </div>
    </div>
  );
}

/* ---------------- Timeline Tab ---------------- */
type TLEntry = { type: "consultation" | "appointment" | "document" | "payment"; date: string; label: string };
function TimelineTab({ patientId }: { patientId: number }) {
  const { t } = useLang();
  const [items, setItems] = useState<TLEntry[]>([]);

  useEffect(() => {
    (async () => {
      const [cons, apts, docs, pays] = await Promise.all([
        db.consultations.where("patientId").equals(patientId).toArray(),
        db.appointments.where("patientId").equals(patientId).toArray(),
        db.documents.where("patientId").equals(patientId).toArray(),
        db.payments.where("patientId").equals(patientId).toArray(),
      ]);
      const out: TLEntry[] = [];
      cons.filter(c => c.isLatest !== false).forEach(c =>
        out.push({ type: "consultation", date: c.date, label: c.diagnosis || t("tl.consultation") }));
      apts.forEach(a =>
        out.push({ type: "appointment", date: `${a.date}T${a.time || "00:00"}`, label: a.reason || t("tl.appointment") }));
      docs.forEach(d =>
        out.push({ type: "document", date: d.createdAt, label: d.name }));
      pays.forEach(p =>
        out.push({ type: "payment", date: p.createdAt, label: `${p.amountPaid}/${p.amountDue} XAF` }));
      out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setItems(out);
    })();
  }, [patientId, t]);

  if (!items.length) return <p className="text-muted-foreground text-center py-6 text-sm">{t("tl.empty")}</p>;

  const icon = (t: TLEntry["type"]) => {
    switch (t) {
      case "consultation": return <Stethoscope className="w-4 h-4" />;
      case "appointment": return <Calendar className="w-4 h-4" />;
      case "document": return <FileText className="w-4 h-4" />;
      case "payment": return <CreditCard className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-2 pt-3">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-3 border-l-2 border-primary/30 pl-3 py-1">
          <div className="text-primary mt-0.5">{icon(it.type)}</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">{new Date(it.date).toLocaleString()}</p>
            <p className="text-sm truncate">{it.label}</p>
          </div>
          <Badge variant="outline" className="text-[10px]">{t(`tl.${it.type}`)}</Badge>
        </div>
      ))}
    </div>
  );
}
