import React, { useEffect, useState, useMemo } from "react";
import { db, type Patient, type Appointment } from "@/lib/db";
import { decryptPatients } from "@/lib/patientCrypto";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, CalendarDays, Stethoscope, Clock, UserPlus, ClipboardPlus, CalendarPlus, Search, UserRound, TriangleAlert as AlertTriangle, Database, X, Settings2, Bell, CreditCard, Sun, Moon } from "lucide-react";
import type { Page } from "@/components/AppLayout";

interface Props { onNavigate?: (page: Page) => void; }

type WidgetId =
  | "recentPatients" | "todayAgenda" | "quickStats"
  | "backupReminder" | "activeAlerts" | "unpaidBalances" | "followUp";

interface WidgetDef {
  id: WidgetId;
  labelKey: string;
  defaultVisible: Record<string, boolean>;
}

const WIDGETS: WidgetDef[] = [
  { id: "recentPatients", labelKey: "dash.widget.recentPatients", defaultVisible: { admin: true, doctor: true, receptionist: true } },
  { id: "todayAgenda", labelKey: "dash.widget.todayAgenda", defaultVisible: { admin: true, doctor: true, receptionist: true } },
  { id: "quickStats", labelKey: "dash.widget.quickStats", defaultVisible: { admin: true, doctor: true, receptionist: false } },
  { id: "backupReminder", labelKey: "dash.widget.backupReminder", defaultVisible: { admin: true, doctor: false, receptionist: false } },
  { id: "activeAlerts", labelKey: "dash.widget.activeAlerts", defaultVisible: { admin: true, doctor: true, receptionist: false } },
  { id: "unpaidBalances", labelKey: "dash.widget.unpaidBalances", defaultVisible: { admin: true, doctor: true, receptionist: true } },
  { id: "followUp", labelKey: "loyalty.patientsToFollowUp", defaultVisible: { admin: true, doctor: true, receptionist: false } },
];

const WIDGET_PREFS_KEY = "divinelink.dashboard.widgets";

function loadWidgetPrefs(role: string): Record<WidgetId, boolean> {
  try {
    const raw = localStorage.getItem(WIDGET_PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const defaults: Record<WidgetId, boolean> = {} as any;
  for (const w of WIDGETS) defaults[w.id] = w.defaultVisible[role] ?? true;
  return defaults;
}

function saveWidgetPrefs(prefs: Record<WidgetId, boolean>) {
  try { localStorage.setItem(WIDGET_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

export function DashboardPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [stats, setStats] = useState({ patients: 0, todayAppts: 0, weekAppts: 0, consultations: 0, activeAlerts: 0 });
  const [recent, setRecent] = useState<Patient[]>([]);
  const [todayAppts, setTodayAppts] = useState<(Appointment & { patientName: string })[]>([]);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [widgetPrefs, setWidgetPrefs] = useState<Record<WidgetId, boolean>>(() =>
    loadWidgetPrefs(user?.role || "receptionist")
  );
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [unpaidPatients, setUnpaidPatients] = useState<{ name: string; balance: number; id: number; daysOverdue: number }[]>([]);
  const [followUpPatients, setFollowUpPatients] = useState<{ name: string; days: number; lastDx: string; id: number }[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [todayConsultations, setTodayConsultations] = useState<{ id: number; patientId: number; date: string; diagnosis: string; isNew: boolean }[]>([]);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [briefingDismissed, setBriefingDismissed] = useState(() => {
    try { return !!localStorage.getItem(`dl.briefing.dismissed.${new Date().toISOString().split("T")[0]}`); } catch { return false; }
  });
  const [eodDismissed, setEodDismissed] = useState(() => {
    try { return !!localStorage.getItem(`dl.eod.dismissed.${new Date().toISOString().split("T")[0]}`); } catch { return false; }
  });

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().split("T")[0];
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const [patients, todayApptsCount, weekAppts, consultations, recentRaw, allPatients, todayApptsRaw] = await Promise.all([
        db.patients.count(),
        db.appointments.where("date").equals(today).count(),
        db.appointments.where("date")
          .between(weekStart.toISOString().split("T")[0], weekEnd.toISOString().split("T")[0], true, true)
          .count(),
        db.consultations.count(),
        db.patients.orderBy("id").reverse().limit(5).toArray(),
        db.patients.toArray(),
        db.appointments.where("date").equals(today).toArray(),
      ]);

      const decryptedPatients = await decryptPatients(allPatients);
      const decryptedRecent = await decryptPatients(recentRaw);
      const patMap = new Map(decryptedPatients.map(p => [p.id!, p]));

      const enrichedAppts = todayApptsRaw
        .sort((a, b) => a.time.localeCompare(b.time))
        .map(a => ({
          ...a,
          patientName: patMap.get(a.patientId)
            ? `${patMap.get(a.patientId)!.firstName} ${patMap.get(a.patientId)!.lastName}`
            : "—",
        }));

      // Active alerts: backup overdue (>7 days) + count
      const lastSync = localStorage.getItem("dl.sync.lastExport.v1");
      setLastBackup(lastSync);
      let alertCount = 0;
      if (!lastSync || (Date.now() - new Date(lastSync).getTime()) > 7 * 86400_000) alertCount++;

      // Unpaid balances
      const allPayments = await db.payments.toArray();
      const unpaidMap = new Map<number, { balance: number; oldestCreatedAt: string }>();
      allPayments.forEach(p => {
        const bal = Math.max(0, (p.amountDue || 0) - (p.amountPaid || 0));
        if (bal > 0) {
          const cur = unpaidMap.get(p.patientId);
          const oldest = cur
            ? (p.createdAt < cur.oldestCreatedAt ? p.createdAt : cur.oldestCreatedAt)
            : p.createdAt;
          unpaidMap.set(p.patientId, { balance: (cur?.balance || 0) + bal, oldestCreatedAt: oldest });
        }
      });
      const unpaidList: { name: string; balance: number; id: number; daysOverdue: number }[] = [];
      unpaidMap.forEach(({ balance: bal, oldestCreatedAt }, pid) => {
        const pat = decryptedPatients.find(p => p.id === pid);
        const daysOverdue = Math.floor((Date.now() - new Date(oldestCreatedAt).getTime()) / 86400000);
        if (pat) unpaidList.push({ name: `${pat.firstName} ${pat.lastName}`, balance: bal, id: pid, daysOverdue });
      });
      unpaidList.sort((a, b) => b.balance - a.balance);
      setUnpaidPatients(unpaidList);

      // Follow-up patients (lost >90 days)
      const allCons = await db.consultations.toArray();
      const lastVisitMap = new Map<number, { date: string; dx: string }>();
      allCons.filter(c => c.isLatest !== false).forEach(c => {
        const cur = lastVisitMap.get(c.patientId);
        const d = c.date || c.createdAt;
        if (!cur || d > cur.date) lastVisitMap.set(c.patientId, { date: d, dx: c.diagnosis || "" });
      });
      const followUp: { name: string; days: number; lastDx: string; id: number }[] = [];
      decryptedPatients.forEach(p => {
        if (!p.id) return;
        const lv = lastVisitMap.get(p.id);
        if (!lv) { followUp.push({ name: `${p.firstName} ${p.lastName}`, days: 999, lastDx: "", id: p.id }); return; }
        const days = Math.floor((Date.now() - new Date(lv.date).getTime()) / 86400000);
        if (days > 90) followUp.push({ name: `${p.firstName} ${p.lastName}`, days, lastDx: lv.dx, id: p.id });
      });
      followUp.sort((a, b) => b.days - a.days);
      setFollowUpPatients(followUp);

      // Low stock drugs
      const lowStock = await db.drugs.where("status").anyOf(["low", "out"]).count();
      setLowStockCount(lowStock);

      // Today's consultations
      const todayStr = new Date().toISOString().split("T")[0];
      const allConsultations = await db.consultations.toArray();
      const todayConults = allConsultations.filter(c => c.date && c.date.startsWith(todayStr));
      // Determine new vs returning patients
      const patientFirstConsult = new Map<number, string>();
      allConsultations
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .forEach(c => {
          if (!patientFirstConsult.has(c.patientId)) patientFirstConsult.set(c.patientId, c.date || "");
        });
      const todayConsultsWithFlag = todayConults.map(c => ({
        id: c.id!,
        patientId: c.patientId,
        date: c.date,
        diagnosis: c.diagnosis || "",
        isNew: patientFirstConsult.get(c.patientId) === c.date,
      }));
      setTodayConsultations(todayConsultsWithFlag);

      // Today's revenue
      const todayPayments = allPayments.filter(p => p.createdAt && p.createdAt.startsWith(todayStr));
      const revenue = todayPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
      setTodayRevenue(revenue);

      setStats({ patients, todayAppts: todayApptsCount, weekAppts, consultations, activeAlerts: alertCount });
      setRecent(decryptedRecent);
      setTodayAppts(enrichedAppts);
    })();
  }, []);

  const toggleWidget = (id: WidgetId) => {
    setWidgetPrefs(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveWidgetPrefs(next);
      return next;
    });
  };

  const resetWidgets = () => {
    const defaults = loadWidgetPrefs(user?.role || "receptionist");
    setWidgetPrefs(defaults);
    saveWidgetPrefs(defaults);
  };

  const calcAge = (dob: string) => {
    if (!dob) return "—";
    const d = new Date(dob);
    if (isNaN(d.getTime())) return "—";
    const diff = Date.now() - d.getTime();
    return String(Math.floor(diff / (365.25 * 24 * 3600 * 1000)));
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  const backupOverdue = !lastBackup || (Date.now() - new Date(lastBackup).getTime()) > 7 * 86400_000;

  const cards = [
    { title: t("dash.totalPatients"), value: stats.patients, icon: Users, bg: "bg-primary/10", fg: "text-primary" },
    { title: t("dash.todayAppts"), value: stats.todayAppts, icon: CalendarDays, bg: "bg-secondary/15", fg: "text-secondary" },
    { title: t("dash.consultWeek"), value: stats.weekAppts, icon: Clock, bg: "bg-info/10", fg: "text-info" },
    { title: t("dash.alerts"), value: stats.activeAlerts, icon: AlertTriangle, bg: backupOverdue ? "bg-warning/15" : "bg-success/10", fg: backupOverdue ? "text-warning" : "text-success" },
  ];

  const actions = [
    { label: t("dash.newPatient"), icon: UserPlus, page: "patients" as Page, bg: "bg-primary", fg: "text-primary-foreground" },
    { label: t("dash.newConsult"), icon: ClipboardPlus, page: "consultations" as Page, bg: "bg-success", fg: "text-success-foreground" },
    { label: t("dash.newAppt"), icon: CalendarPlus, page: "appointments" as Page, bg: "bg-info", fg: "text-info-foreground" },
    { label: t("dash.searchAction"), icon: Search, page: "patients" as Page, bg: "bg-muted", fg: "text-foreground" },
  ];

  const visibleWidgets = WIDGETS.filter(w => widgetPrefs[w.id]);

  // Time-based card visibility
  const now = new Date();
  const currentHour = now.getHours();
  const isMorning = currentHour >= 5 && currentHour < 10;
  const isEvening = currentHour >= 18 && currentHour < 22;
  const todayDateStr = new Date().toISOString().split("T")[0];

  const showBriefing = isMorning && !briefingDismissed;
  const showEod = isEvening && !eodDismissed;

  const dismissBriefing = () => {
    try { localStorage.setItem(`dl.briefing.dismissed.${todayDateStr}`, "1"); } catch {}
    setBriefingDismissed(true);
  };
  const dismissEod = () => {
    try { localStorage.setItem(`dl.eod.dismissed.${todayDateStr}`, "1"); } catch {}
    setEodDismissed(true);
  };

  // Days since last backup
  const daysSinceBackup = lastBackup
    ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400_000)
    : null;

  // Appointment in next 60 minutes
  const apptWithin60Min = (() => {
    const nowMinutes = currentHour * 60 + now.getMinutes();
    return todayAppts.find(a => {
      const [h, m] = a.time.split(":").map(Number);
      const apptMinutes = h * 60 + m;
      return apptMinutes >= nowMinutes && apptMinutes - nowMinutes <= 60;
    });
  })();

  // First appointment time
  const firstApptTime = todayAppts.length > 0 ? todayAppts[0].time : null;

  // End of day: top 3 diagnoses
  const topDiagnoses = (() => {
    const counts = new Map<string, number>();
    todayConsultations.forEach(c => {
      if (c.diagnosis) counts.set(c.diagnosis, (counts.get(c.diagnosis) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  })();

  // End of day: new vs returning
  const newPatientCount = todayConsultations.filter(c => c.isNew).length;
  const returningPatientCount = todayConsultations.length - newPatientCount;

  // Motivational message
  const motivationKey = (() => {
    const n = todayConsultations.length;
    if (n >= 12) return "eod.motiv12";
    if (n >= 8) return "eod.motiv8";
    if (n >= 4) return "eod.motiv4";
    return "eod.motiv0";
  })();

  // French formatted date
  const frenchDate = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="-m-4 md:-m-6">
      {/* Gradient header */}
      <div
        className="px-5 pt-5 pb-6 text-primary-foreground"
        style={{
          background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.75) 100%)",
          minHeight: 130,
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs opacity-80">{t("dash.welcome")}</p>
            <h1 className="text-2xl font-bold mt-1">{user?.name}</h1>
            <p className="text-xs opacity-80 mt-1">
              {new Date().toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <button
            onClick={() => setCustomizeOpen(true)}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            title={t("dash.customize")}
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Morning Briefing Card */}
      {showBriefing && (
        <div className="mx-4 -mt-4 mb-0 rounded-2xl overflow-hidden relative" style={{ background: "linear-gradient(135deg, #FF9A56 0%, #FFD194 50%, #FFF3E0 100%)" }}>
          <button onClick={dismissBriefing} className="absolute top-3 right-3 p-1 rounded-full bg-white/30 hover:bg-white/50 transition-colors z-10">
            <X className="w-4 h-4 text-amber-900" />
          </button>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Sun className="w-5 h-5 text-amber-700" />
              <h2 className="text-lg font-bold text-amber-900">{t("briefing.title")} {user?.name?.split(" ")[0]}</h2>
            </div>
            <p className="text-sm text-amber-800/80 mb-4 capitalize">{frenchDate}</p>

            {/* Today's appointments */}
            <div className="bg-white/40 rounded-xl p-3 mb-3">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-5xl font-bold text-amber-900">{stats.todayAppts}</p>
                  <p className="text-xs text-amber-800/70 mt-0.5">{t("briefing.todayAppts")}</p>
                </div>
                {firstApptTime && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-700" />
                    <div>
                      <p className="text-xs text-amber-800/70">{t("briefing.firstAppt")}</p>
                      <p className="text-sm font-semibold text-amber-900">{firstApptTime}</p>
                    </div>
                  </div>
                )}
              </div>
              {apptWithin60Min && (
                <div className="mt-2 flex items-center gap-2 bg-orange-200/70 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-orange-700" />
                  <p className="text-sm font-semibold text-orange-800">{t("briefing.nextAppt")} ({apptWithin60Min.time})</p>
                </div>
              )}
            </div>

            {/* Sub-info row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white/40 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-amber-900">{lowStockCount}</p>
                <p className="text-[10px] text-amber-800/70">{t("briefing.lowStock")}</p>
              </div>
              <div className="bg-white/40 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-amber-900">{unpaidPatients.length}</p>
                <p className="text-[10px] text-amber-800/70">{t("briefing.unpaid")}</p>
              </div>
              <div className="bg-white/40 rounded-xl p-3 text-center">
                {daysSinceBackup === null ? (
                  <>
                    <p className="text-lg font-bold text-red-600">!</p>
                    <p className="text-[10px] text-red-600">{t("briefing.noBackup")}</p>
                  </>
                ) : (
                  <>
                    <p className={`text-2xl font-bold ${daysSinceBackup > 3 ? "text-red-600" : "text-amber-900"}`}>{daysSinceBackup}</p>
                    <p className="text-[10px] text-amber-800/70">{t("briefing.backupDays")}</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* End of Day Summary Card */}
      {showEod && (
        <div className="mx-4 -mt-4 mb-0 rounded-2xl overflow-hidden relative" style={{ background: "linear-gradient(135deg, #1a3a4a 0%, #2d6a7a 30%, #e8a87c 70%, #ffd194 100%)" }}>
          <button onClick={dismissEod} className="absolute top-3 right-3 p-1 rounded-full bg-white/20 hover:bg-white/40 transition-colors z-10">
            <X className="w-4 h-4 text-white/80" />
          </button>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Moon className="w-5 h-5 text-amber-200" />
              <h2 className="text-lg font-bold text-white">{t("eod.title")}</h2>
            </div>

            {/* Patients seen today - large number */}
            <div className="bg-white/15 rounded-xl p-4 mb-3 text-center">
              <p className="text-5xl font-bold text-white">{todayConsultations.length}</p>
              <p className="text-sm text-white/70 mt-1">{t("eod.patientsToday")}</p>
            </div>

            {/* New vs returning */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-white/15 rounded-xl p-3 text-center">
                <p className="text-3xl font-bold text-green-300">{newPatientCount}</p>
                <p className="text-xs text-white/70">{t("eod.newPatients")}</p>
              </div>
              <div className="bg-white/15 rounded-xl p-3 text-center">
                <p className="text-3xl font-bold text-blue-300">{returningPatientCount}</p>
                <p className="text-xs text-white/70">{t("eod.returning")}</p>
              </div>
            </div>

            {/* Top 3 diagnoses */}
            {topDiagnoses.length > 0 && (
              <div className="bg-white/15 rounded-xl p-3 mb-3">
                <p className="text-xs text-white/70 mb-2">{t("eod.topDiagnoses")}</p>
                <ul className="space-y-1">
                  {topDiagnoses.map(([dx, count], i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <span className="text-white truncate">{dx}</span>
                      <Badge className="bg-white/20 text-white text-[10px] ml-2">{count}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Revenue */}
            <div className="bg-white/15 rounded-xl p-3 mb-3 text-center">
              <p className="text-4xl font-bold text-white">{todayRevenue.toLocaleString("fr-FR")}</p>
              <p className="text-xs text-white/70 mt-1">{t("eod.revenue")} (FCFA)</p>
            </div>

            {/* Motivational message */}
            <p className="text-center text-lg font-semibold text-white/90">{t(motivationKey)}</p>
          </div>
        </div>
      )}

      <div className="bg-background px-4 py-4 space-y-5">
        {/* Stats 2x2 */}
        <div className="grid grid-cols-2 gap-3 -mt-10">
          {cards.map((c, i) => {
            const Icon = c.icon;
            return (
              <Card key={i} className="p-3 flex flex-col justify-between" style={{ minHeight: 90, maxHeight: 100 }}>
                <div className="flex items-start justify-between">
                  <p className="text-3xl font-bold leading-none">{c.value}</p>
                  <div className={`w-8 h-8 rounded-lg ${c.bg} ${c.fg} flex items-center justify-center`}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 truncate">{c.title}</p>
              </Card>
            );
          })}
        </div>

        {/* Quick actions — larger touch-friendly cards */}
        <div>
          <h2 className="text-base font-semibold mb-3">{t("dash.quickActions")}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {actions.map((a, i) => {
              const Icon = a.icon;
              return (
                <button
                  key={i}
                  onClick={() => onNavigate?.(a.page)}
                  className={`${a.bg} ${a.fg} rounded-2xl flex flex-col items-center justify-center gap-2 active:scale-95 hover:scale-[1.03] hover:shadow-lg transition-all duration-150 shadow-sm py-5 px-3 min-h-[120px]`}
                >
                  <Icon className="w-8 h-8" />
                  <span className="text-sm font-semibold text-center leading-tight">{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Widgets */}
        <div className="space-y-4">
          {visibleWidgets.map(w => (
            <div key={w.id}>
              {w.id === "recentPatients" && (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold">{t("dash.widget.recentPatients")}</h2>
                    <button onClick={() => toggleWidget(w.id)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {recent.length === 0 ? (
                    <div className="flex flex-col items-center py-6 text-muted-foreground">
                      <UserRound className="w-10 h-10 mb-2 opacity-50" />
                      <p className="text-sm">{t("dash.noPatients")}</p>
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {recent.map(p => (
                        <li
                          key={p.id}
                          className="py-2 flex items-center gap-3 active:bg-accent/50 -mx-2 px-2 rounded cursor-pointer"
                          onClick={() => onNavigate?.("patients")}
                        >
                          <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm overflow-hidden">
                            {p.photo ? <img src={p.photo} alt="" className="w-full h-full object-cover" /> : <>{p.firstName.charAt(0)}{p.lastName.charAt(0)}</>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{p.firstName} {p.lastName}</p>
                            <p className="text-xs text-muted-foreground">
                              {calcAge(p.dob)} &bull; {t("dash.lastVisit")}: {fmtDate(p.updatedAt || p.createdAt)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              {w.id === "todayAgenda" && (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-primary" />
                      {t("dash.widget.todayAgenda")}
                    </h2>
                    <button onClick={() => toggleWidget(w.id)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {todayAppts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t("dash.noAppointments")}</p>
                  ) : (
                    <ul className="divide-y">
                      {todayAppts.slice(0, 5).map(a => (
                        <li key={a.id} className="py-2 flex items-center gap-3">
                          <span className="text-sm font-mono font-semibold text-primary min-w-[48px]">{a.time}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{a.patientName}</p>
                            <p className="text-xs text-muted-foreground truncate">{a.reason || "—"}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              {w.id === "quickStats" && (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <Stethoscope className="w-4 h-4 text-success" />
                      {t("dash.widget.quickStats")}
                    </h2>
                    <button onClick={() => toggleWidget(w.id)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-2xl font-bold text-primary">{stats.patients}</p>
                      <p className="text-[10px] text-muted-foreground">{t("dash.totalPatients")}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-secondary">{stats.consultations}</p>
                      <p className="text-[10px] text-muted-foreground">{t("nav.consultations")}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-info">{stats.weekAppts}</p>
                      <p className="text-[10px] text-muted-foreground">{t("dash.thisWeek")}</p>
                    </div>
                  </div>
                </Card>
              )}

              {w.id === "backupReminder" && (
                <Card className={`p-4 ${backupOverdue ? "border-warning/50 bg-warning/5" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <Database className={`w-4 h-4 ${backupOverdue ? "text-warning" : "text-success"}`} />
                      {t("dash.widget.backupReminder")}
                    </h2>
                    <button onClick={() => toggleWidget(w.id)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {backupOverdue ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-warning text-warning-foreground text-[10px] font-bold">!</span>
                      <p className="text-sm text-warning">{t("dash.backupOverdue")}</p>
                      <Button size="sm" variant="outline" className="ml-auto" onClick={() => onNavigate?.("backup")}>
                        {t("nav.backup")}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-success">{t("dash.backupOk")}</p>
                  )}
                </Card>
              )}

              {w.id === "activeAlerts" && (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <Bell className="w-4 h-4 text-warning" />
                      {t("dash.widget.activeAlerts")}
                    </h2>
                    <button onClick={() => toggleWidget(w.id)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {stats.activeAlerts === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">{t("common.noData")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {backupOverdue && (
                        <li className="flex items-center gap-2 text-sm">
                          <span className="w-2 h-2 rounded-full bg-warning" />
                          <span className="text-warning">{t("dash.backupOverdue")}</span>
                          <Button size="sm" variant="ghost" className="ml-auto text-xs h-7" onClick={() => onNavigate?.("backup")}>
                            {t("nav.backup")}
                          </Button>
                        </li>
                      )}
                    </ul>
                  )}
                </Card>
              )}

              {w.id === "unpaidBalances" && (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-destructive" />
                      {t("dash.widget.unpaidBalances")}
                    </h2>
                    <div className="flex items-center gap-1">
                      <button onClick={() => onNavigate?.("payments")} className="text-xs text-primary hover:underline px-1">
                        {t("dash.viewAll")}
                      </button>
                      <button onClick={() => toggleWidget(w.id)} className="text-muted-foreground hover:text-foreground p-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {unpaidPatients.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">{t("common.noData")}</p>
                  ) : (
                    <ul className="divide-y">
                      {unpaidPatients.filter(p => p.daysOverdue >= 7).slice(0, 5).map(p => (
                        <li key={p.id} className="py-2 flex items-center justify-between text-sm gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="truncate font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.daysOverdue} j impayé</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-destructive font-bold">{p.balance.toLocaleString()} FCFA</span>
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => onNavigate?.("payments")}>
                              Voir
                            </Button>
                          </div>
                        </li>
                      ))}
                      {unpaidPatients.filter(p => p.daysOverdue < 7).length > 0 && unpaidPatients.filter(p => p.daysOverdue >= 7).length === 0 && (
                        <li className="py-2 text-sm text-muted-foreground text-center">{unpaidPatients.length} impayés — &lt; 7 jours</li>
                      )}
                    </ul>
                  )}
                </Card>
              )}

              {w.id === "followUp" && (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-destructive" />
                      {t("loyalty.patientsToFollowUp")}
                    </h2>
                    <button onClick={() => toggleWidget(w.id)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {followUpPatients.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">{t("common.noData")}</p>
                  ) : (
                    <ul className="divide-y">
                      {followUpPatients.slice(0, 8).map(p => (
                        <li key={p.id} className="py-2 flex items-center gap-2 text-sm">
                          <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.days === 999 ? t("loyalty.lost") : `${p.days} ${t("loyalty.daysAgo")}`}
                              {p.lastDx && ` • ${t("loyalty.lastDx")}: ${p.lastDx}`}
                            </p>
                          </div>
                          <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => onNavigate?.("appointments")}>
                            <CalendarPlus className="w-3 h-3" />{t("loyalty.takeAppt")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Customize widgets dialog */}
      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("dash.customizeTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {WIDGETS.map(w => (
              <label key={w.id} className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={widgetPrefs[w.id]}
                  onCheckedChange={() => toggleWidget(w.id)}
                />
                <span className="text-sm">{t(w.labelKey)}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button variant="outline" size="sm" onClick={resetWidgets}>
              {t("dx.clear")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
