import React, { useState, useMemo, useCallback, useEffect } from "react";
import { db, type Consultation, type Patient, type ToothRecord, type ToothCondition, type DentalTreatment, type DentalMaterial, type DentalRecord } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, RotateCcw, Download, Search, UserPlus } from "lucide-react";
import { AIClinicalAssistant, AIButton } from "@/components/AIClinicalAssistant";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { decryptPatients } from "@/lib/patientCrypto";
import { saveFile, toCsv, withDateStamp } from "@/lib/download";

/* FDI tooth numbers */
const ADULT_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
const ADULT_UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28];
const ADULT_LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38];
const ADULT_LOWER_RIGHT = [41, 42, 43, 44, 45, 46, 47, 48];

const PEDIATRIC_UPPER_RIGHT = [55, 54, 53, 52, 51];
const PEDIATRIC_UPPER_LEFT = [61, 62, 63, 64, 65];
const PEDIATRIC_LOWER_LEFT = [71, 72, 73, 74, 75];
const PEDIATRIC_LOWER_RIGHT = [81, 82, 83, 84, 85];

const CONDITION_COLORS: Record<ToothCondition, string> = {
  healthy: "#22c55e",
  decayed: "#ef4444",
  missing: "#1c1917",
  crowned: "#f97316",
  filled: "#3b82f6",
  fractured: "#d4d4d4",
  to_extract: "#eab308",
  mobile: "#a855f7",
};

const CONDITION_EMOJI: Record<ToothCondition, string> = {
  healthy: "🟢", decayed: "🔴", missing: "⚫", crowned: "🟠",
  filled: "🔵", fractured: "⚪", to_extract: "🟡", mobile: "🟣",
};

const CONDITIONS: ToothCondition[] = ["healthy", "decayed", "missing", "crowned", "filled", "fractured", "to_extract", "mobile"];
const TREATMENTS: DentalTreatment[] = ["filling_amalgam", "filling_composite", "filling_gi", "pulpectomy", "extraction_simple", "extraction_surgical", "crown", "scaling", "root_canal", "other"];
const MATERIALS: DentalMaterial[] = ["amalgam", "composite", "gi", "ceramic", "gold"];

function makeEmptyTeeth(pediatric: boolean): ToothRecord[] {
  const nums = pediatric
    ? [...PEDIATRIC_UPPER_RIGHT, ...PEDIATRIC_UPPER_LEFT, ...PEDIATRIC_LOWER_LEFT, ...PEDIATRIC_LOWER_RIGHT]
    : [...ADULT_UPPER_RIGHT, ...ADULT_UPPER_LEFT, ...ADULT_LOWER_LEFT, ...ADULT_LOWER_RIGHT];
  return nums.map(n => ({ number: n, condition: "healthy" as ToothCondition }));
}

/* SVG Tooth component */
function ToothSVG({ number, record, onClick, selected }: { number: number; record: ToothRecord; onClick: () => void; selected: boolean }) {
  const color = CONDITION_COLORS[record.condition] || "#94a3b8";
  const isMissing = record.condition === "missing";

  return (
    <g
      onClick={onClick}
      className="cursor-pointer transition-transform"
      style={{ transform: selected ? "scale(1.1)" : undefined, transformOrigin: "center" }}
    >
      <rect
        x={-10} y={-14} width={20} height={28} rx={4}
        fill={isMissing ? "transparent" : color}
        stroke={selected ? "#fff" : "hsl(var(--border))"}
        strokeWidth={selected ? 2.5 : 1}
        opacity={isMissing ? 0.2 : 0.85}
      />
      {isMissing && (
        <line x1={-8} y1={-12} x2={8} y2={12} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
      )}
      <text
        y={4} textAnchor="middle" fill={isMissing ? "hsl(var(--muted-foreground))" : "#fff"}
        fontSize={9} fontWeight={700} fontFamily="monospace" style={{ pointerEvents: "none" }}
      >
        {number}
      </text>
    </g>
  );
}

/* Tooth chart grid */
function ToothChart({ teeth, pediatric, onSelect }: { teeth: ToothRecord[]; pediatric: boolean; onSelect: (n: number) => void }) {
  const map = new Map(teeth.map(t => [t.number, t]));
  const [selected, setSelected] = useState<number | null>(null);

  const handleClick = (n: number) => { setSelected(n); onSelect(n); };

  const renderRow = (nums: number[], y: number, spacing: number) => (
    <g transform={`translate(0, ${y})`}>
      {nums.map((n, i) => (
        <g key={n} transform={`translate(${i * spacing + spacing / 2}, 0)`}>
          <ToothSVG number={n} record={map.get(n) || { number: n, condition: "healthy" }} onClick={() => handleClick(n)} selected={selected === n} />
        </g>
      ))}
    </g>
  );

  const ur = pediatric ? PEDIATRIC_UPPER_RIGHT : ADULT_UPPER_RIGHT;
  const ul = pediatric ? PEDIATRIC_UPPER_LEFT : ADULT_UPPER_LEFT;
  const ll = pediatric ? PEDIATRIC_LOWER_LEFT : ADULT_LOWER_LEFT;
  const lr = pediatric ? PEDIATRIC_LOWER_RIGHT : ADULT_LOWER_RIGHT;
  const count = pediatric ? 5 : 8;
  const spacing = 28;
  const w = count * spacing + 20;

  return (
    <svg viewBox={`0 0 ${w * 2 + 20} 140`} className="w-full max-w-lg mx-auto" style={{ maxHeight: 200 }}>
      {/* Upper jaw */}
      {renderRow(ur, 20, spacing)}
      {renderRow([...ul].reverse(), 20, spacing).props.children && (
        <g transform={`translate(${w + 10}, 0)`}>
          {ul.map((n, i) => (
            <g key={n} transform={`translate(${i * spacing + spacing / 2}, 20)`}>
              <ToothSVG number={n} record={map.get(n) || { number: n, condition: "healthy" }} onClick={() => handleClick(n)} selected={selected === n} />
            </g>
          ))}
        </g>
      )}
      {/* Divider */}
      <line x1={0} y1={55} x2={w * 2 + 20} y2={55} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="4 2" />
      {/* Lower jaw */}
      <g transform={`translate(0, 70)`}>
        {ll.map((n, i) => (
          <g key={n} transform={`translate(${i * spacing + spacing / 2}, 20)`}>
            <ToothSVG number={n} record={map.get(n) || { number: n, condition: "healthy" }} onClick={() => handleClick(n)} selected={selected === n} />
          </g>
        ))}
      </g>
      <g transform={`translate(${w + 10}, 70)`}>
        {[...lr].reverse().map((n, i) => (
          <g key={n} transform={`translate(${(lr.length - 1 - i) * spacing + spacing / 2}, 20)`}>
            <ToothSVG number={n} record={map.get(n) || { number: n, condition: "healthy" }} onClick={() => handleClick(n)} selected={selected === n} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/* Reusable tooth editor used in both desktop Card and mobile Sheet */
function ToothEditor({ selectedRecord, updateTooth, t }: { selectedRecord: ToothRecord; updateTooth: (p: Partial<ToothRecord>) => void; t: (k: string) => string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{t("dental.condition")}</Label>
          <Select value={selectedRecord.condition} onValueChange={v => updateTooth({ condition: v as ToothCondition })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONDITIONS.map(c => <SelectItem key={c} value={c}>{CONDITION_EMOJI[c]} {t(`dental.${c}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("dental.treatment")}</Label>
          <Select value={selectedRecord.treatmentDone || "__none__"} onValueChange={v => updateTooth({ treatmentDone: (v === "__none__" ? undefined : v) as DentalTreatment })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("common.noData")}</SelectItem>
              {TREATMENTS.map(tr => <SelectItem key={tr} value={tr}>{t(`dental.${tr}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{t("dental.material")}</Label>
          <Select value={selectedRecord.material || "__none__"} onValueChange={v => updateTooth({ material: (v === "__none__" ? undefined : v) as DentalMaterial })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("common.noData")}</SelectItem>
              {MATERIALS.map(m => <SelectItem key={m} value={m}>{t(`dental.mat.${m}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("dental.notes")}</Label>
          <Input value={selectedRecord.notes || ""} onChange={e => updateTooth({ notes: e.target.value })} />
        </div>
      </div>
    </>
  );
}

/* ============ Main page ============ */
export function DentalExamPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const isMobile = useIsMobile();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [pediatric, setPediatric] = useState(false);
  const [teeth, setTeeth] = useState<ToothRecord[]>(() => makeEmptyTeeth(false));
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [dental, setDental] = useState<DentalRecord>({
    teeth: [],
    bleeding: false, mobility: 0, plaqueIndex: 0, gingivalIndex: 0,
    motif: "", painType: "", painIntensity: 0, painDuration: "",
    findings: "", dentalDiagnosis: "", treatmentPlan: "", treatmentDone: "", nextAppointment: "",
  });
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const all = await decryptPatients(await db.patients.toArray());
      setPatients(all);
    })();
  }, []);

  const loadPatientDental = async (patientId: number) => {
    const cons = await db.consultations
      .where("patientId").equals(patientId)
      .and(c => c.consultType === "dental" && c.isLatest !== false)
      .reverse().sortBy("date");
    setConsultations(cons);
    if (cons.length > 0 && cons[0].dental) {
      setTeeth(cons[0].dental.teeth || makeEmptyTeeth(pediatric));
      setDental(cons[0].dental);
    } else {
      setTeeth(makeEmptyTeeth(pediatric));
      setDental({ teeth: [], bleeding: false, mobility: 0, plaqueIndex: 0, gingivalIndex: 0, motif: "", painType: "", painIntensity: 0, painDuration: "", findings: "", dentalDiagnosis: "", treatmentPlan: "", treatmentDone: "", nextAppointment: "" });
    }
  };

  useEffect(() => {
    if (selectedPatientId) loadPatientDental(parseInt(selectedPatientId));
  }, [selectedPatientId]);

  const togglePediatric = (v: boolean) => {
    setPediatric(v);
    setTeeth(makeEmptyTeeth(v));
  };

  const handleToothSelect = (n: number) => setSelectedTooth(n);

  const updateTooth = (patch: Partial<ToothRecord>) => {
    if (selectedTooth === null) return;
    setTeeth(prev => prev.map(t => t.number === selectedTooth ? { ...t, ...patch } : t));
  };

  const selectedRecord = teeth.find(t => t.number === selectedTooth);

  const save = async () => {
    if (!selectedPatientId || !user?.id) return;
    const now = new Date().toISOString();
    const dentalData: DentalRecord = { ...dental, teeth };
    await db.consultations.add({
      patientId: parseInt(selectedPatientId),
      doctorId: user.id,
      date: now,
      symptoms: dental.motif || "",
      diagnosis: dental.dentalDiagnosis || "",
      treatmentPlan: dental.treatmentPlan || "",
      prescription: "",
      notes: dental.findings || "",
      consultType: "dental",
      dental: dentalData,
      createdAt: now,
      versionNumber: 1,
      isLatest: true,
    });
    toast.success(t("common.save"));
    loadPatientDental(parseInt(selectedPatientId));
  };

  const exportResearch = async () => {
    const allCons = await db.consultations.where("consultType").equals("dental").toArray();
    if (!allCons.length) { toast.info(t("download.empty")); return; }
    const rows = allCons.map(c => ({
      patientId: c.patientId,
      date: (c.createdAt || c.date).slice(0, 10),
      diagnosis: c.dental?.dentalDiagnosis || c.diagnosis || "",
      treatment: c.dental?.treatmentDone || "",
      teeth: (c.dental?.teeth || []).filter(t => t.condition !== "healthy").map(t => `${t.number}:${t.condition}`).join(";"),
    }));
    const csv = toCsv(rows as unknown as Record<string, unknown>[]);
    const ok = await saveFile(withDateStamp("dental_research.csv"), csv, "csv");
    if (ok) toast.success(t("download.done"));
  };

  /* Stats */
  const dentalStats = useMemo(() => {
    const conditionCounts: Record<string, number> = {};
    const treatmentCounts: Record<string, number> = {};
    const materialCounts: Record<string, number> = {};
    teeth.forEach(t => {
      if (t.condition !== "healthy") conditionCounts[t.condition] = (conditionCounts[t.condition] || 0) + 1;
      if (t.treatmentDone) treatmentCounts[t.treatmentDone] = (treatmentCounts[t.treatmentDone] || 0) + 1;
      if (t.material) materialCounts[t.material] = (materialCounts[t.material] || 0) + 1;
    });
    return { conditionCounts, treatmentCounts, materialCounts };
  }, [teeth]);

  return (
    <div className="space-y-4">
      {/* Patient selector */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Label>{t("apt.patient")}</Label>
          <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
            <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
            <SelectContent>
              {patients.map(p => <SelectItem key={p.id} value={p.id!.toString()}>{p.firstName} {p.lastName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => window.location.hash = "#patients"}>
          <UserPlus className="w-4 h-4" /> Nouveau patient
        </Button>
        <div className="flex items-center gap-2 border rounded-md px-3 py-2">
          <span className="text-sm">{t("dental.adult")}</span>
          <Switch checked={pediatric} onCheckedChange={togglePediatric} />
          <span className="text-sm">{t("dental.pediatric")}</span>
        </div>
      </div>

      {/* Tooth chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            {t("dental.chart")}
            <div className="flex flex-wrap gap-2 text-[10px]">
              {CONDITIONS.map(c => (
                <span key={c} className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: CONDITION_COLORS[c] }} />
                  {t(`dental.${c}`)}
                </span>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ToothChart teeth={teeth} pediatric={pediatric} onSelect={handleToothSelect} />
        </CardContent>
      </Card>

      {/* Selected tooth panel — Sheet on mobile, Card on desktop */}
      {selectedTooth !== null && selectedRecord && !isMobile && (
        <Card className="border-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("dental.tooth")} {selectedTooth} {CONDITION_EMOJI[selectedRecord.condition]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ToothEditor selectedRecord={selectedRecord} updateTooth={updateTooth} t={t} />
          </CardContent>
        </Card>
      )}
      <Sheet open={isMobile && selectedTooth !== null} onOpenChange={o => !o && setSelectedTooth(null)}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("dental.tooth")} {selectedTooth} {selectedRecord && CONDITION_EMOJI[selectedRecord.condition]}</SheetTitle>
          </SheetHeader>
          {selectedRecord && (
            <div className="mt-4 space-y-3">
              <ToothEditor selectedRecord={selectedRecord} updateTooth={updateTooth} t={t} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Periodontal section */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t("dental.periodontal")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <Switch checked={dental.bleeding || false} onCheckedChange={v => setDental(d => ({ ...d, bleeding: v }))} />
              <Label className="text-sm">{t("dental.bleeding")}</Label>
            </div>
            <div>
              <Label className="text-xs">{t("dental.mobility")} (0-3)</Label>
              <Select value={String(dental.mobility || 0)} onValueChange={v => setDental(d => ({ ...d, mobility: parseInt(v) as 0 | 1 | 2 | 3 }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[0, 1, 2, 3].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("dental.pocketDepth")}</Label>
              <Input value={dental.pocketDepth || ""} onChange={e => setDental(d => ({ ...d, pocketDepth: e.target.value }))} placeholder="mm" />
            </div>
            <div>
              <Label className="text-xs">{t("dental.recession")}</Label>
              <Input value={dental.recession || ""} onChange={e => setDental(d => ({ ...d, recession: e.target.value }))} placeholder="mm" />
            </div>
            <div>
              <Label className="text-xs">{t("dental.plaqueIndex")}</Label>
              <Input type="number" min={0} max={100} value={dental.plaqueIndex || 0} onChange={e => setDental(d => ({ ...d, plaqueIndex: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <Label className="text-xs">{t("dental.gingivalIndex")}</Label>
              <Input type="number" min={0} max={3} step={0.1} value={dental.gingivalIndex || 0} onChange={e => setDental(d => ({ ...d, gingivalIndex: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Clinical form — collapsible accordion */}
      <Card>
        <CardContent className="pt-4">
          <Accordion type="multiple" defaultValue={["motif", "diagnosis"]} className="w-full">
            <AccordionItem value="motif">
              <AccordionTrigger className="text-sm font-semibold">Motif & Douleur</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label className="text-xs">{t("dental.motif")}</Label><Input value={dental.motif || ""} onChange={e => setDental(d => ({ ...d, motif: e.target.value }))} /></div>
                  <div><Label className="text-xs">{t("dental.painType")}</Label><Input value={dental.painType || ""} onChange={e => setDental(d => ({ ...d, painType: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">{t("dental.painIntensity")}</Label>
                    <div className="flex items-center gap-2">
                      <Slider value={[dental.painIntensity || 0]} onValueChange={([v]) => setDental(d => ({ ...d, painIntensity: v }))} min={0} max={10} step={1} className="flex-1" />
                      <span className="text-sm font-bold w-6 text-center">{dental.painIntensity || 0}</span>
                    </div>
                  </div>
                  <div><Label className="text-xs">{t("dental.painDuration")}</Label><Input value={dental.painDuration || ""} onChange={e => setDental(d => ({ ...d, painDuration: e.target.value }))} /></div>
                  <div><Label className="text-xs">{t("dental.nextAppt")}</Label><Input type="date" value={dental.nextAppointment || ""} onChange={e => setDental(d => ({ ...d, nextAppointment: e.target.value }))} /></div>
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="findings">
              <AccordionTrigger className="text-sm font-semibold">Examen & Findings</AccordionTrigger>
              <AccordionContent>
                <Label className="text-xs">{t("dental.findings")}</Label>
                <Textarea value={dental.findings || ""} onChange={e => setDental(d => ({ ...d, findings: e.target.value }))} rows={4} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="diagnosis">
              <AccordionTrigger className="text-sm font-semibold">Diagnostic & Plan</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <div><Label className="text-xs">{t("dental.diagnosis")}</Label><Textarea value={dental.dentalDiagnosis || ""} onChange={e => setDental(d => ({ ...d, dentalDiagnosis: e.target.value }))} /></div>
                <div><Label className="text-xs">{t("dental.plan")}</Label><Textarea value={dental.treatmentPlan || ""} onChange={e => setDental(d => ({ ...d, treatmentPlan: e.target.value }))} /></div>
                <div><Label className="text-xs">{t("dental.done")}</Label><Textarea value={dental.treatmentDone || ""} onChange={e => setDental(d => ({ ...d, treatmentDone: e.target.value }))} /></div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <Button onClick={save} disabled={!selectedPatientId} className="gap-2"><Save className="w-4 h-4" />{t("common.save")}</Button>
        <Button variant="outline" onClick={exportResearch} className="gap-2"><Download className="w-4 h-4" />{t("dental.exportResearch")}</Button>
        <AIButton onClick={() => setAiOpen(true)} position="inline" />
      </div>

      {/* Previous dental consultations */}
      {consultations.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("consult.history")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {consultations.slice(0, 10).map(c => (
              <div key={c.id} className="border rounded-md p-3 text-sm">
                <p className="text-xs text-muted-foreground">{new Date(c.createdAt || c.date).toLocaleString()}</p>
                {c.dental?.dentalDiagnosis && <p><span className="font-medium">{t("dental.diagnosis")}:</span> {c.dental.dentalDiagnosis}</p>}
                {c.dental?.treatmentDone && <p><span className="font-medium">{t("dental.done")}:</span> {c.dental.treatmentDone}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* AI Clinical Assistant */}
      <AIClinicalAssistant
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        patientContext={selectedPatientId ? {
          patient: patients.find(p => p.id === parseInt(selectedPatientId))!,
        } : undefined}
      />
    </div>
  );
}
