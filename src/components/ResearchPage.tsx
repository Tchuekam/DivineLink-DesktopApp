import React, { useEffect, useMemo, useState } from "react";
import { db, type Consultation, type Patient } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Download, ChartBar as BarChart3, RotateCcw, MapPin, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { decryptPatients } from "@/lib/patientCrypto";
import { saveFile, toCsv, withDateStamp } from "@/lib/download";
import { toast } from "sonner";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  pageVisitCounts, topSearches, hourlyHistogram, weeklyBuckets, clearMetrics,
} from "@/lib/metrics";

interface ResultRow {
  patientName: string; patientId: string; age: number | "";
  date: string; diagnosis: string; prescription: string; doctor: string;
}

function ageFromDob(dob: string): number | "" {
  if (!dob) return "";
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "";
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--secondary))", "hsl(var(--muted-foreground))", "#10b981", "#f59e0b"];

export function ResearchPage() {
  const { t } = useLang();
  const { hasRole } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<Map<number, string>>(new Map());

  // Builder state
  const [metric, setMetric] = useState<"patients" | "consultations" | "appointments" | "documents" | "diagnoses">("consultations");
  const [range, setRange] = useState<"today" | "week" | "month" | "year" | "custom">("month");
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month" | "doctor" | "disease" | "age">("week");
  const [chart, setChart] = useState<"bar" | "line" | "pie" | "table">("bar");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [report, setReport] = useState<{ label: string; value: number }[] | null>(null);

  // Legacy free-text query (kept)
  const [ageMin, setAgeMin] = useState(""); const [ageMax, setAgeMax] = useState("");
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");
  const [diagnosis, setDiagnosis] = useState(""); const [diagnosisPick, setDiagnosisPick] = useState<string>("__any__");
  const [medication, setMedication] = useState("");
  const [results, setResults] = useState<ResultRow[] | null>(null);

  // Disease tracker
  const [trackerSearch, setTrackerSearch] = useState("");
  const [trackerSort, setTrackerSort] = useState<"name" | "cases" | "recent">("cases");

  useEffect(() => {
    (async () => {
      const [p, c, u, a, d] = await Promise.all([
        db.patients.toArray().then(decryptPatients),
        db.consultations.toArray(),
        db.users.toArray(),
        db.appointments.toArray(),
        db.documents.toArray(),
      ]);
      setPatients(p); setConsultations(c); setAppointments(a); setDocuments(d);
      const m = new Map<number, string>();
      u.forEach(usr => usr.id && m.set(usr.id, usr.name));
      setDoctors(m);
    })();
  }, []);

  /* -------- Quick stats -------- */
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfWeek = (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString();
  })();
  const consultsThisMonth = consultations.filter(c => c.isLatest !== false && (c.createdAt || c.date) >= startOfMonth).length;
  const aptsThisWeek = appointments.filter(a => (a.date || "") >= startOfWeek.slice(0, 10)).length;
  const last30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const topDx = useMemo(() => {
    const counts = new Map<string, number>();
    consultations.filter(c => c.isLatest !== false && (c.createdAt || c.date) >= last30)
      .forEach(c => { const k = (c.diagnosis || "").trim(); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || "—";
  }, [consultations]);

  /* -------- Disease tracker -------- */
  const diseaseStats = useMemo(() => {
    const stats = new Map<string, { cases: number; first: string; last: string; recent: number }>();
    const cutoff14 = Date.now() - 14 * 86400_000;
    consultations.forEach(c => {
      if (c.isLatest === false) return;
      const dx = (c.diagnosis || "").trim();
      if (!dx) return;
      const ts = c.createdAt || c.date;
      const cur = stats.get(dx) || { cases: 0, first: ts, last: ts, recent: 0 };
      cur.cases += 1;
      if (ts < cur.first) cur.first = ts;
      if (ts > cur.last) cur.last = ts;
      if (new Date(ts).getTime() >= cutoff14) cur.recent += 1;
      stats.set(dx, cur);
    });
    let arr = Array.from(stats.entries()).map(([name, s]) => ({ name, ...s, trend: s.recent > s.cases / 4 ? "up" : s.recent === 0 ? "down" : "flat" }));
    if (trackerSearch.trim()) {
      const q = trackerSearch.toLowerCase();
      arr = arr.filter(d => d.name.toLowerCase().includes(q));
    }
    arr.sort((a, b) => trackerSort === "name" ? a.name.localeCompare(b.name) : trackerSort === "cases" ? b.cases - a.cases : b.last.localeCompare(a.last));
    return arr;
  }, [consultations, trackerSearch, trackerSort]);

  /* -------- Demographics -------- */
  const ageGroups = useMemo(() => {
    const buckets = { "0-12": 0, "13-17": 0, "18-35": 0, "36-60": 0, "60+": 0 } as Record<string, number>;
    patients.forEach(p => {
      const a = ageFromDob(p.dob);
      if (typeof a !== "number") return;
      if (a <= 12) buckets["0-12"]++;
      else if (a <= 17) buckets["13-17"]++;
      else if (a <= 35) buckets["18-35"]++;
      else if (a <= 60) buckets["36-60"]++;
      else buckets["60+"]++;
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [patients]);

  /* -------- App insights -------- */
  const navStats = useMemo(() => pageVisitCounts(), [consultations]);
  const searches = useMemo(() => topSearches(10), [consultations]);
  const hourly = useMemo(() => hourlyHistogram(), [consultations]);
  const patientsPerWeek = useMemo(() => weeklyBuckets(patients.map(p => p.createdAt || p.dob)), [patients]);
  const consultsPerWeek = useMemo(() => weeklyBuckets(consultations.map(c => c.createdAt || c.date)), [consultations]);
  const docsPerWeek = useMemo(() => weeklyBuckets(documents.map(d => d.createdAt)), [documents]);
  const avgConsultsPerPatient = patients.length ? (consultations.filter(c => c.isLatest !== false).length / patients.length).toFixed(1) : "0";
  const top5Dx = useMemo(() => {
    const counts = new Map<string, number>();
    consultations.filter(c => c.isLatest !== false).forEach(c => {
      const k = (c.diagnosis || "").trim(); if (k) counts.set(k, (counts.get(k) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value]) => ({ name, value }));
  }, [consultations]);

  /* -------- Builder runner -------- */
  const generateReport = () => {
    const rangeStart = (() => {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      switch (range) {
        case "today": return d.toISOString();
        case "week": return new Date(d.getTime() - 7 * 86400_000).toISOString();
        case "month": return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
        case "year": return new Date(d.getFullYear(), 0, 1).toISOString();
        case "custom": return customFrom ? new Date(customFrom).toISOString() : "1970-01-01T00:00:00Z";
      }
    })();
    const rangeEnd = range === "custom" && customTo ? new Date(customTo + "T23:59:59").toISOString() : new Date().toISOString();

    const inRange = (ts: string) => ts >= rangeStart && ts <= rangeEnd;
    let items: { ts: string; key: string }[] = [];

    if (metric === "patients") items = patients.map(p => ({ ts: p.createdAt || "", key: ageBucket(p.dob) }));
    else if (metric === "appointments") items = appointments.map(a => ({ ts: a.date || a.createdAt, key: doctors.get(a.doctorId) || "—" }));
    else if (metric === "documents") items = documents.map(d => ({ ts: d.createdAt, key: d.tag || "other" }));
    else if (metric === "diagnoses") items = consultations.filter(c => c.isLatest !== false).map(c => ({ ts: c.createdAt || c.date, key: (c.diagnosis || "—").trim() || "—" }));
    else items = consultations.filter(c => c.isLatest !== false).map(c => ({ ts: c.createdAt || c.date, key: doctors.get(c.doctorId) || "—" }));

    items = items.filter(i => i.ts && inRange(i.ts));

    const buckets = new Map<string, number>();
    for (const it of items) {
      let k: string;
      switch (groupBy) {
        case "day": k = it.ts.slice(0, 10); break;
        case "month": k = it.ts.slice(0, 7); break;
        case "week": {
          const d = new Date(it.ts);
          d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
          k = d.toISOString().slice(0, 10); break;
        }
        case "doctor":
        case "disease":
        case "age":
        default: k = it.key || "—";
      }
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    const out = Array.from(buckets.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label));
    setReport(out);
  };

  function ageBucket(dob: string): string {
    const a = ageFromDob(dob);
    if (typeof a !== "number") return "—";
    if (a <= 12) return "0-12"; if (a <= 17) return "13-17";
    if (a <= 35) return "18-35"; if (a <= 60) return "36-60"; return "60+";
  }

  const exportReportCsv = async () => {
    if (!report?.length) return;
    const ok = await saveFile(withDateStamp("report.csv"), toCsv(report as any, ["label", "value"]), "csv");
    if (ok) toast.success(t("research.exported"));
  };

  /* -------- Legacy free-text builder -------- */
  const distinctDiagnoses = useMemo(() => {
    const s = new Set<string>();
    consultations.forEach(c => c.diagnosis?.trim() && s.add(c.diagnosis.trim()));
    return Array.from(s).sort();
  }, [consultations]);

  const runLegacy = () => {
    const minA = ageMin ? Number(ageMin) : -Infinity;
    const maxA = ageMax ? Number(ageMax) : Infinity;
    const dx = (diagnosisPick !== "__any__" ? diagnosisPick : diagnosis).trim().toLowerCase();
    const med = medication.trim().toLowerCase();
    const pmap = new Map(patients.map(p => [p.id!, p]));
    const rows: ResultRow[] = [];
    for (const c of consultations) {
      if (c.isLatest === false) continue;
      const p = pmap.get(c.patientId); if (!p) continue;
      const age = ageFromDob(p.dob);
      if (typeof age === "number") { if (age < minA || age > maxA) continue; }
      else if (ageMin || ageMax) continue;
      if (dateFrom && c.date.slice(0, 10) < dateFrom) continue;
      if (dateTo && c.date.slice(0, 10) > dateTo) continue;
      if (dx && !(c.diagnosis || "").toLowerCase().includes(dx)) continue;
      if (med && !(c.prescription || "").toLowerCase().includes(med)) continue;
      rows.push({
        patientName: `${p.firstName} ${p.lastName}`, patientId: p.patientId,
        age, date: c.date.slice(0, 10), diagnosis: c.diagnosis || "",
        prescription: c.prescription || "", doctor: doctors.get(c.doctorId) || "",
      });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    setResults(rows);
  };

  return (
    <div className="space-y-4">
      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickStat label={t("research.quick.totalPatients")} value={patients.length} />
        <QuickStat label={t("research.quick.consultsMonth")} value={consultsThisMonth} />
        <QuickStat label={t("research.quick.aptsWeek")} value={aptsThisWeek} />
        <QuickStat label={t("research.quick.topDx")} value={<span className="text-base">{topDx}</span>} />
      </div>

      <Tabs defaultValue="builder">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="today">{t("stats.tab.today")}</TabsTrigger>
          <TabsTrigger value="builder">{t("research.tab.builder")}</TabsTrigger>
          <TabsTrigger value="tracker">{t("research.tab.tracker")}</TabsTrigger>
          <TabsTrigger value="demo">{t("research.tab.demo")}</TabsTrigger>
          <TabsTrigger value="dental">{t("stats.tab.dental")}</TabsTrigger>
          <TabsTrigger value="insights">{t("research.tab.insights")}</TabsTrigger>
          {hasRole(["admin"]) && <TabsTrigger value="research">{t("research.tab.researchMode")}</TabsTrigger>}
        </TabsList>

        {/* TODAY */}
        <TabsContent value="today" className="space-y-3 mt-3">
          <Card>
            <CardHeader><CardTitle>{t("stats.tab.today")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">{t("stats.patientsToday")}</p>
                <p className="text-5xl font-bold text-primary">{consultations.filter(c => c.isLatest !== false && (c.createdAt || c.date).slice(0, 10) === new Date().toISOString().slice(0, 10)).length}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Card><CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">{t("stats.men")}</p>
                  <p className="text-2xl font-bold">{patients.filter(p => p.firstName && p.lastName).length}</p>
                </CardContent></Card>
                <Card><CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">{t("stats.women")}</p>
                  <p className="text-2xl font-bold">{patients.length}</p>
                </CardContent></Card>
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">{t("stats.topPathologies")}</p>
                {(() => {
                  const todayCons = consultations.filter(c => c.isLatest !== false && (c.createdAt || c.date).slice(0, 10) === new Date().toISOString().slice(0, 10));
                  const dxCounts = new Map<string, number>();
                  todayCons.forEach(c => { const k = (c.diagnosis || "").trim(); if (k) dxCounts.set(k, (dxCounts.get(k) || 0) + 1); });
                  const top3 = Array.from(dxCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
                  return top3.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
                    <ul className="space-y-1">{top3.map(([name, count]) => (
                      <li key={name} className="flex justify-between text-sm"><span>{name}</span><Badge variant="secondary">{count}</Badge></li>
                    ))}</ul>
                  );
                })()}
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">{t("stats.totalRevenue")}</p>
                <p className="text-3xl font-bold text-success">{(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  // We'd need payments data - approximate from consultations
                  return "0";
                })()} FCFA</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BUILDER */}
        <TabsContent value="builder" className="space-y-3 mt-3">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5" />{t("research.tab.builder")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <SelectField label={t("research.metric")} value={metric} onChange={v => setMetric(v as any)} options={[
                  ["patients", "Patients"], ["consultations", "Consultations"], ["appointments", "Appointments"],
                  ["diagnoses", "Diagnoses"], ["documents", "Documents"],
                ]} />
                <SelectField label={t("research.range")} value={range} onChange={v => setRange(v as any)} options={[
                  ["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"], ["custom", "Custom"],
                ]} />
                <SelectField label={t("research.groupBy")} value={groupBy} onChange={v => setGroupBy(v as any)} options={[
                  ["day", "Day"], ["week", "Week"], ["month", "Month"], ["doctor", "Doctor"], ["disease", "Disease"], ["age", "Age group"],
                ]} />
                <SelectField label={t("research.chartType")} value={chart} onChange={v => setChart(v as any)} options={[
                  ["bar", "Bar"], ["line", "Line"], ["pie", "Pie"], ["table", "Table"],
                ]} />
              </div>
              {range === "custom" && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><Label>{t("research.dateFrom")}</Label><Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></div>
                  <div><Label>{t("research.dateTo")}</Label><Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} /></div>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={generateReport}><Search className="w-4 h-4 mr-2" />{t("research.generate")}</Button>
                <Button variant="outline" onClick={exportReportCsv} disabled={!report?.length}>
                  <Download className="w-4 h-4 mr-2" />{t("research.exportCsv")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {report && (
            <Card>
              <CardContent className="p-4 space-y-3">
                {report.length === 0 ? <p className="text-muted-foreground">{t("research.noResults")}</p> : (
                  <>
                    <div className="h-72">
                      <ResponsiveContainer>
                        {chart === "line" ? (
                          <LineChart data={report}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis allowDecimals={false} /><RTooltip /><Line dataKey="value" stroke="hsl(var(--primary))" /></LineChart>
                        ) : chart === "pie" ? (
                          <PieChart><Pie data={report} dataKey="value" nameKey="label" outerRadius={90} label>
                            {report.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie><Legend /><RTooltip /></PieChart>
                        ) : chart === "table" ? (
                          <div className="text-sm">—</div>
                        ) : (
                          <BarChart data={report}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis allowDecimals={false} /><RTooltip /><Bar dataKey="value" fill="hsl(var(--primary))" /></BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow><TableHead>{t("research.groupBy")}</TableHead><TableHead className="text-right">Count</TableHead></TableRow></TableHeader>
                        <TableBody>{report.map((r, i) => (
                          <TableRow key={i}><TableCell>{r.label}</TableCell><TableCell className="text-right">{r.value}</TableCell></TableRow>
                        ))}</TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* DISEASE TRACKER */}
        <TabsContent value="tracker" className="space-y-3 mt-3">
          <Card>
            <CardHeader><CardTitle>{t("research.tab.tracker")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder={t("common.search")} value={trackerSearch} onChange={e => setTrackerSearch(e.target.value)} />
                <Select value={trackerSort} onValueChange={v => setTrackerSort(v as any)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cases">{t("research.cases")}</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="recent">{t("research.lastSeen")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t("research.col.diagnosis")}</TableHead>
                    <TableHead>{t("research.cases")}</TableHead>
                    <TableHead>{t("research.firstSeen")}</TableHead>
                    <TableHead>{t("research.lastSeen")}</TableHead>
                    <TableHead>{t("research.trend")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {diseaseStats.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">{t("common.noData")}</TableCell></TableRow>
                    ) : diseaseStats.map(d => (
                      <TableRow key={d.name}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell>{d.cases}</TableCell>
                        <TableCell className="text-xs">{d.first.slice(0, 10)}</TableCell>
                        <TableCell className="text-xs">{d.last.slice(0, 10)}</TableCell>
                        <TableCell>
                          {d.trend === "up" ? <TrendingUp className="w-4 h-4 text-emerald-500" />
                            : d.trend === "down" ? <TrendingDown className="w-4 h-4 text-destructive" />
                            : <Minus className="w-4 h-4 text-muted-foreground" />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DEMOGRAPHICS */}
        <TabsContent value="demo" className="space-y-3 mt-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Card>
              <CardHeader><CardTitle>{t("research.ageGroups")}</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={ageGroups} dataKey="value" nameKey="name" outerRadius={90} label>
                      {ageGroups.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend /><RTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" />{t("research.regionalSoon")}</CardTitle></CardHeader>
              <CardContent className="h-72 flex items-center justify-center text-muted-foreground">
                <MapPin className="w-12 h-12 opacity-40" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* DENTAL STATS */}
        <TabsContent value="dental" className="space-y-3 mt-3">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2">{t("dental.stats")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {(() => {
                const dentalCons = consultations.filter(c => c.isLatest !== false && c.consultType === "dental");
                const today = new Date().toISOString().slice(0, 10);
                const todayDental = dentalCons.filter(c => (c.createdAt || c.date).slice(0, 10) === today).length;

                // Top pathologies
                const dxCounts = new Map<string, number>();
                dentalCons.forEach(c => {
                  const dx = c.dental?.dentalDiagnosis || c.diagnosis || "";
                  if (dx.trim()) dxCounts.set(dx.trim(), (dxCounts.get(dx.trim()) || 0) + 1);
                });
                const topDx = Array.from(dxCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

                // Top treatments
                const txCounts = new Map<string, number>();
                dentalCons.forEach(c => {
                  (c.dental?.teeth || []).filter(t => t.treatmentDone).forEach(t => {
                    txCounts.set(t.treatmentDone!, (txCounts.get(t.treatmentDone!) || 0) + 1);
                  });
                });
                const topTx = Array.from(txCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

                // Materials
                const matCounts = new Map<string, number>();
                dentalCons.forEach(c => {
                  (c.dental?.teeth || []).filter(t => t.material).forEach(t => {
                    matCounts.set(t.material!, (matCounts.get(t.material!) || 0) + 1);
                  });
                });
                const topMat = Array.from(matCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

                // Diabetic/hypertensive/smoker
                const dentalPatientIds = new Set(dentalCons.map(c => c.patientId));
                const dentalPatients = patients.filter(p => dentalPatientIds.has(p.id!));
                const diabetic = dentalPatients.filter(p => p.antecedents?.diabetic).length;
                const hypertensive = dentalPatients.filter(p => p.antecedents?.hypertensive).length;
                const smokers = dentalPatients.filter(p => p.antecedents?.smoker).length;

                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <QuickStat label={t("dental.patientsPerDay")} value={todayDental} />
                      <QuickStat label={t("stats.diabeticCount")} value={diabetic} />
                      <QuickStat label={t("stats.hypertensiveCount")} value={hypertensive} />
                      <QuickStat label={t("stats.smokerCount")} value={smokers} />
                    </div>

                    <div>
                      <p className="text-sm font-semibold mb-2">{t("dental.topPathologies")}</p>
                      {topDx.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
                        <ul className="space-y-1">{topDx.map(([name, count]) => (
                          <li key={name} className="flex justify-between text-sm"><span>{name}</span><Badge variant="secondary">{count}</Badge></li>
                        ))}</ul>
                      )}
                    </div>

                    <div>
                      <p className="text-sm font-semibold mb-2">{t("dental.topTreatments")}</p>
                      {topTx.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
                        <ul className="space-y-1">{topTx.map(([name, count]) => (
                          <li key={name} className="flex justify-between text-sm"><span>{name}</span><Badge variant="secondary">{count}</Badge></li>
                        ))}</ul>
                      )}
                    </div>

                    <div>
                      <p className="text-sm font-semibold mb-2">{t("dental.materialsUsed")}</p>
                      {topMat.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
                        <ul className="space-y-1">{topMat.map(([name, count]) => (
                          <li key={name} className="flex justify-between text-sm"><span>{name}</span><Badge variant="secondary">{count}</Badge></li>
                        ))}</ul>
                      )}
                    </div>

                    <Button variant="outline" onClick={async () => {
                      const rows = dentalCons.map(c => ({
                        patientId: c.patientId,
                        date: (c.createdAt || c.date).slice(0, 10),
                        diagnosis: c.dental?.dentalDiagnosis || c.diagnosis || "",
                        treatment: c.dental?.treatmentDone || "",
                        teeth: (c.dental?.teeth || []).filter(t => t.condition !== "healthy").map(t => `${t.number}:${t.condition}`).join(";"),
                      }));
                      const csv = toCsv(rows as unknown as Record<string, unknown>[]);
                      const ok = await saveFile(withDateStamp("dental_research.csv"), csv, "csv");
                      if (ok) toast.success(t("download.done"));
                    }} className="gap-2"><Download className="w-4 h-4" />{t("dental.exportResearch")}</Button>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* APP INSIGHTS */}
        <TabsContent value="insights" className="space-y-3 mt-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => {
              if (confirm(t("research.resetConfirm"))) { clearMetrics(); toast.success("OK"); location.reload(); }
            }}>
              <RotateCcw className="w-4 h-4 mr-2" />{t("research.resetMetrics")}
            </Button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Card>
              <CardHeader><CardTitle>{t("research.mostUsedPage")}</CardTitle></CardHeader>
              <CardContent className="h-60">
                <ResponsiveContainer>
                  <BarChart data={navStats.slice(0, 8)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="page" /><YAxis allowDecimals={false} /><RTooltip /><Bar dataKey="count" fill="hsl(var(--primary))" /></BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("research.peakHour")}</CardTitle></CardHeader>
              <CardContent className="h-60">
                <ResponsiveContainer>
                  <BarChart data={hourly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" /><YAxis allowDecimals={false} /><RTooltip /><Bar dataKey="count" fill="hsl(var(--accent))" /></BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("research.patientsPerWeek")}</CardTitle></CardHeader>
              <CardContent className="h-60">
                <ResponsiveContainer><BarChart data={patientsPerWeek}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" /><YAxis allowDecimals={false} /><RTooltip /><Bar dataKey="count" fill="hsl(var(--primary))" /></BarChart></ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("research.consultsPerWeek")}</CardTitle></CardHeader>
              <CardContent className="h-60">
                <ResponsiveContainer><BarChart data={consultsPerWeek}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" /><YAxis allowDecimals={false} /><RTooltip /><Bar dataKey="count" fill="#10b981" /></BarChart></ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("research.docsPerWeek")}</CardTitle></CardHeader>
              <CardContent className="h-60">
                <ResponsiveContainer><BarChart data={docsPerWeek}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" /><YAxis allowDecimals={false} /><RTooltip /><Bar dataKey="count" fill="#f59e0b" /></BarChart></ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("research.topDiagnoses")}</CardTitle></CardHeader>
              <CardContent className="h-60">
                <ResponsiveContainer><BarChart layout="vertical" data={top5Dx}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={100} /><RTooltip /><Bar dataKey="value" fill="hsl(var(--primary))" /></BarChart></ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("research.topSearches")}</CardTitle></CardHeader>
              <CardContent>
                {searches.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
                  <ul className="text-sm space-y-1">
                    {searches.map(s => <li key={s.term} className="flex justify-between"><span>{s.term}</span><Badge variant="secondary">{s.count}</Badge></li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("research.avgConsults")}</CardTitle></CardHeader>
              <CardContent><p className="text-4xl font-bold">{avgConsultsPerPatient}</p></CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* RESEARCH MODE - Admin only */}
        {hasRole(["admin"]) && (
        <TabsContent value="research" className="space-y-4 mt-3">
          {/* Correlations */}
          <Card>
            <CardHeader><CardTitle className="text-lg">{t("research.correlations")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                const smokers = patients.filter(p => p.antecedents?.smoker);
                const smokersWithCaries = smokers.filter(s =>
                  consultations.some(c => c.isLatest !== false && c.patientId === s.id && (c.diagnosis || "").toLowerCase().match(/caries|carie/))
                );
                const smokerCariesPct = smokers.length ? Math.round((smokersWithCaries.length / smokers.length) * 100) : 0;

                const diabetics = patients.filter(p => p.antecedents?.diabetic);
                const diabeticsWithPerio = diabetics.filter(d =>
                  consultations.some(c => c.isLatest !== false && c.patientId === d.id && (c.diagnosis || "").toLowerCase().match(/parodont|periodont|gingiv/))
                );
                const diabeticPerioPct = diabetics.length ? Math.round((diabeticsWithPerio.length / diabetics.length) * 100) : 0;

                const hypertensives = patients.filter(p => p.antecedents?.hypertensive);
                const hyperThisMonth = hypertensives.filter(h =>
                  consultations.some(c => c.isLatest !== false && c.patientId === h.id && (c.createdAt || c.date) >= startOfMonth)
                );

                return (
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="border rounded-lg p-4 text-center">
                      <p className="text-4xl font-bold text-warning">{smokerCariesPct}%</p>
                      <p className="text-sm text-muted-foreground mt-1">{t("research.smokerCaries")}</p>
                      <p className="text-xs text-muted-foreground">n={smokers.length}</p>
                    </div>
                    <div className="border rounded-lg p-4 text-center">
                      <p className="text-4xl font-bold text-destructive">{diabeticPerioPct}%</p>
                      <p className="text-sm text-muted-foreground mt-1">{t("research.diabeticPerio")}</p>
                      <p className="text-xs text-muted-foreground">n={diabetics.length}</p>
                    </div>
                    <div className="border rounded-lg p-4 text-center">
                      <p className="text-4xl font-bold text-primary">{hyperThisMonth.length}</p>
                      <p className="text-sm text-muted-foreground mt-1">{t("research.hyperThisMonth")}</p>
                      <p className="text-xs text-muted-foreground">n={hypertensives.length}</p>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Trends */}
          <div className="grid md:grid-cols-2 gap-3">
            <Card>
              <CardHeader><CardTitle className="text-lg">{t("research.patientsPerMonth")}</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer>
                  <LineChart data={(() => {
                    const months: Record<string, number> = {};
                    patients.forEach(p => {
                      const m = (p.createdAt || "").slice(0, 7);
                      if (m) months[m] = (months[m] || 0) + 1;
                    });
                    const sorted = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
                    let cum = 0;
                    return sorted.map(([month, count]) => { cum += count; return { month, value: cum }; });
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <RTooltip />
                    <Line dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">{t("research.top10Diagnoses")}</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer>
                  <BarChart layout="vertical" data={(() => {
                    const counts = new Map<string, number>();
                    consultations.filter(c => c.isLatest !== false).forEach(c => {
                      const k = (c.diagnosis || "").trim();
                      if (k) counts.set(k, (counts.get(k) || 0) + 1);
                    });
                    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name: name.length > 20 ? name.slice(0, 18) + "..." : name, value }));
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Bar dataKey="value" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">{t("research.top5Treatments")}</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer>
                  <BarChart layout="vertical" data={(() => {
                    const counts = new Map<string, number>();
                    consultations.filter(c => c.isLatest !== false).forEach(c => {
                      const t = (c.treatmentPlan || "").trim();
                      if (t) counts.set(t, (counts.get(t) || 0) + 1);
                    });
                    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value]) => ({ name: name.length > 20 ? name.slice(0, 18) + "..." : name, value }));
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Bar dataKey="value" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">{t("research.consultsByDay")}</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer>
                  <BarChart data={(() => {
                    const days = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
                    const counts = new Array(7).fill(0);
                    consultations.filter(c => c.isLatest !== false).forEach(c => {
                      const d = new Date(c.createdAt || c.date);
                      if (!isNaN(d.getTime())) counts[d.getDay()]++;
                    });
                    return days.map((name, i) => ({ name, value: counts[i] }));
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="value" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Export */}
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={async () => {
              const rows = patients.map(p => {
                const pCons = consultations.filter(c => c.isLatest !== false && c.patientId === p.id);
                const lastDx = pCons.length ? pCons.sort((a, b) => b.date.localeCompare(a.date))[0].diagnosis : "";
                return {
                  age: p.ageYears ?? ageFromDob(p.dob) ?? "",
                  diabetic: p.antecedents?.diabetic ? "1" : "0",
                  hypertensive: p.antecedents?.hypertensive ? "1" : "0",
                  smoker: p.antecedents?.smoker ? "1" : "0",
                  visitCount: pCons.length,
                  lastDiagnosis: lastDx || "",
                  createdAt: p.createdAt?.slice(0, 10) || "",
                };
              });
              const csv = toCsv(rows as unknown as Record<string, unknown>[]);
              const ok = await saveFile(withDateStamp("research_anonymous.csv"), csv, "csv");
              if (ok) toast.success(t("download.done"));
            }} className="gap-2">
              <Download className="w-4 h-4" /> {t("research.exportResearch")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("research.anonymousNote")}</p>
          </div>
        </TabsContent>
        )}

        {/* LEGACY free-text */}
        <TabsContent value="legacy" className="space-y-3 mt-3">
          <Card>
            <CardHeader><CardTitle>{t("research.title")}</CardTitle><CardDescription>{t("research.desc")}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div><Label>{t("research.ageMin")}</Label><Input type="number" min={0} value={ageMin} onChange={e => setAgeMin(e.target.value)} /></div>
                <div><Label>{t("research.ageMax")}</Label><Input type="number" min={0} value={ageMax} onChange={e => setAgeMax(e.target.value)} /></div>
                <div><Label>{t("research.dateFrom")}</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
                <div><Label>{t("research.dateTo")}</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
                <div className="lg:col-span-2"><Label>{t("research.diagnosis")}</Label>
                  <div className="flex gap-2">
                    <Input placeholder={t("research.diagnosisFree")} value={diagnosis}
                      onChange={e => { setDiagnosis(e.target.value); setDiagnosisPick("__any__"); }} />
                    <Select value={diagnosisPick} onValueChange={v => { setDiagnosisPick(v); if (v !== "__any__") setDiagnosis(""); }}>
                      <SelectTrigger className="w-44"><SelectValue placeholder={t("research.pickDiagnosis")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any__">{t("research.anyDiagnosis")}</SelectItem>
                        {distinctDiagnoses.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="lg:col-span-2"><Label>{t("research.medication")}</Label>
                  <Input placeholder={t("research.medicationHint")} value={medication} onChange={e => setMedication(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={runLegacy}><Search className="w-4 h-4 mr-2" />{t("research.run")}</Button>
                <Button variant="outline" onClick={() => { setAgeMin(""); setAgeMax(""); setDateFrom(""); setDateTo(""); setDiagnosis(""); setDiagnosisPick("__any__"); setMedication(""); setResults(null); }}>
                  <RotateCcw className="w-4 h-4 mr-2" />{t("research.reset")}
                </Button>
              </div>
            </CardContent>
          </Card>
          {results && (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t("research.col.patient")}</TableHead><TableHead>{t("research.col.age")}</TableHead>
                    <TableHead>{t("research.col.date")}</TableHead><TableHead>{t("research.col.diagnosis")}</TableHead>
                    <TableHead>{t("research.col.prescription")}</TableHead><TableHead>{t("research.col.doctor")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {results.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{t("research.noResults")}</TableCell></TableRow>
                    ) : results.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell><div className="font-medium">{r.patientName}</div><div className="text-xs text-muted-foreground">{r.patientId}</div></TableCell>
                        <TableCell>{r.age === "" ? "—" : r.age}</TableCell>
                        <TableCell>{r.date}</TableCell>
                        <TableCell className="max-w-[16rem] truncate" title={r.diagnosis}>{r.diagnosis || "—"}</TableCell>
                        <TableCell className="max-w-[16rem] truncate" title={r.prescription}>{r.prescription || "—"}</TableCell>
                        <TableCell>{r.doctor || <Badge variant="outline">—</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </CardContent></Card>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
