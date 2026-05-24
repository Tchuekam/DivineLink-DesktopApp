import React, { useMemo, useState, useEffect } from "react";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { db, type Patient } from "@/lib/db";
import { decryptPatients } from "@/lib/patientCrypto";
import {
  SYSTEMS, rankDiagnoses, symptomLabel,
  type BodySystem, type RankedDiagnosis,
} from "@/lib/diseaseDb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Stethoscope, RotateCcw, Save, History, AlertTriangle, FlaskConical, Activity } from "lucide-react";
import { toast } from "sonner";

type Duration = "acute" | "subacute" | "chronic";
type Severity = "mild" | "moderate" | "severe";

interface HistoryEntry {
  id: string;
  date: string;
  systemId: string;
  systemName: string;
  symptoms: string[];
  duration: Duration;
  severity: Severity;
  topDiagnosis: string;
}

const HISTORY_KEY = "divinelink.dx.history.v1";

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(list: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 10)));
}

export function DiagnosisPage() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const [system, setSystem] = useState<BodySystem | null>(null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [duration, setDuration] = useState<Duration>("acute");
  const [severity, setSeverity] = useState<Severity>("moderate");
  const [results, setResults] = useState<RankedDiagnosis[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState<RankedDiagnosis | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [savePatientId, setSavePatientId] = useState("");

  useEffect(() => {
    db.patients.toArray().then(decryptPatients).then(setPatients);
  }, []);

  const systemName = (s: BodySystem) => lang === "fr" ? s.nameFr : s.nameEn;

  const reset = () => {
    setSystem(null);
    setSymptoms([]);
    setDuration("acute");
    setSeverity("moderate");
    setResults(null);
  };

  const toggleSymptom = (s: string) => {
    setSymptoms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const generate = () => {
    if (!system || symptoms.length === 0) {
      toast.error(t("dx.needSymptoms"));
      return;
    }
    const ranked = rankDiagnoses(system, symptoms, duration, severity);
    setResults(ranked);
    if (ranked[0]) {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        systemId: system.id,
        systemName: systemName(system),
        symptoms,
        duration,
        severity,
        topDiagnosis: ranked[0].name,
      };
      const next = [entry, ...history].slice(0, 10);
      setHistory(next);
      saveHistory(next);
    }
  };

  const confidenceClass = (c: string) =>
    c === "high" ? "bg-success text-primary-foreground"
    : c === "medium" ? "bg-warning text-primary-foreground"
    : "bg-muted text-muted-foreground";

  const saveToConsultation = async () => {
    if (!saveOpen || !savePatientId || !user) return;
    const now = new Date().toISOString();
    const symptomText = symptoms.map(s => symptomLabel(s, lang)).join(", ");
    await db.consultations.add({
      patientId: parseInt(savePatientId),
      doctorId: user.id!,
      date: now,
      symptoms: symptomText,
      diagnosis: saveOpen.name,
      treatmentPlan: "",
      prescription: "",
      notes: `${saveOpen.description}\n\n${t("dx.keyFeatures")}: ${saveOpen.keyFeatures}\n${t("dx.investigations")}: ${saveOpen.investigations}\n${t("dx.redFlags")}: ${saveOpen.redFlags}`,
      createdAt: now,
      versionNumber: 1,
      isLatest: true,
    });
    toast.success(t("dx.savedToConsult"));
    setSaveOpen(null);
    setSavePatientId("");
  };

  // Step 1: pick system
  if (!system) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Stethoscope className="w-5 h-5" /> {t("dx.title")}
          </h1>
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} className="gap-2">
            <History className="w-4 h-4" /> {t("dx.history")} ({history.length})
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t("dx.pickSystem")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {SYSTEMS.map(s => (
            <button
              key={s.id}
              onClick={() => { setSystem(s); setSymptoms([]); setResults(null); }}
              className="text-left p-4 rounded-lg border hover:border-primary hover:bg-accent/50 transition-colors"
            >
              <Activity className="w-6 h-6 mb-2 text-primary" />
              <p className="font-medium text-sm">{systemName(s)}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.diseases.length} {t("dx.conditions")}</p>
            </button>
          ))}
        </div>
        {renderHistoryDialog()}
      </div>
    );
  }

  // Step 2+: chosen system
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={reset}>← {t("common.back")}</Button>
        <h1 className="text-xl font-semibold flex-1">{systemName(system)}</h1>
        <Button variant="outline" size="sm" onClick={reset} className="gap-1">
          <RotateCcw className="w-4 h-4" /> {t("dx.clear")}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("dx.symptoms")}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {system.symptoms.map(s => (
              <label key={s} className="flex items-center gap-2 p-2 rounded border hover:bg-accent/50 cursor-pointer">
                <Checkbox checked={symptoms.includes(s)} onCheckedChange={() => toggleSymptom(s)} />
                <span className="text-sm">{symptomLabel(s, lang)}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">{t("dx.duration")}</CardTitle></CardHeader>
          <CardContent>
            <Select value={duration} onValueChange={v => setDuration(v as Duration)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="acute">{t("dx.acute")}</SelectItem>
                <SelectItem value="subacute">{t("dx.subacute")}</SelectItem>
                <SelectItem value="chronic">{t("dx.chronic")}</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{t("dx.severity")}</CardTitle></CardHeader>
          <CardContent>
            <Select value={severity} onValueChange={v => setSeverity(v as Severity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mild">{t("dx.mild")}</SelectItem>
                <SelectItem value="moderate">{t("dx.moderate")}</SelectItem>
                <SelectItem value="severe">{t("dx.severe")}</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>

      <Button onClick={generate} className="w-full gap-2" size="lg">
        <FlaskConical className="w-4 h-4" /> {t("dx.generate")}
      </Button>

      {results && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">{t("dx.results")} ({results.length})</h2>
          {results.length === 0 && (
            <p className="text-muted-foreground text-center py-8">{t("dx.noMatches")}</p>
          )}
          {results.map((d, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{i + 1}. {d.name}</p>
                    <Badge className={confidenceClass(d.confidence) + " mt-1"}>
                      {t(`dx.conf.${d.confidence}`)}
                    </Badge>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSaveOpen(d)} className="gap-1 flex-shrink-0">
                    <Save className="w-3 h-3" /> {t("dx.save")}
                  </Button>
                </div>
                <p className="text-sm">{d.description}</p>
                <div className="text-xs space-y-1 pt-2 border-t">
                  <p><span className="font-medium">{t("dx.keyFeatures")}:</span> {d.keyFeatures}</p>
                  <p><span className="font-medium">{t("dx.investigations")}:</span> {d.investigations}</p>
                  <p className="text-destructive flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span><span className="font-medium">{t("dx.redFlags")}:</span> {d.redFlags}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Save to consultation dialog */}
      <Dialog open={!!saveOpen} onOpenChange={() => setSaveOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("dx.saveTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">{saveOpen?.name}</p>
            <div>
              <Label>{t("apt.patient")} *</Label>
              <Select value={savePatientId} onValueChange={setSavePatientId}>
                <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id!.toString()}>{p.firstName} {p.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(null)}>{t("common.cancel")}</Button>
            <Button onClick={saveToConsultation} disabled={!savePatientId}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {renderHistoryDialog()}
    </div>
  );

  function renderHistoryDialog() {
    return (
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("dx.history")}</DialogTitle></DialogHeader>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("common.noData")}</p>
          ) : (
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="p-3 rounded border text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{h.topDiagnosis}</span>
                    <span className="text-xs text-muted-foreground">{new Date(h.date).toLocaleDateString()}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{h.systemName} • {h.symptoms.length} {t("dx.symptoms")}</p>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="w-full" onClick={() => { saveHistory([]); setHistory([]); }}>
                {t("dx.clearHistory")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }
}
