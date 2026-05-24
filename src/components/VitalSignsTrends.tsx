import React, { useEffect, useMemo, useState } from "react";
import { db, type Consultation } from "@/lib/db";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VitalPoint {
  date: string;
  dateLabel: string;
  doctor: string;
  [key: string]: string | number | undefined;
}

interface LabPoint {
  date: string;
  dateLabel: string;
  value: number;
  normal: boolean | null;
}

interface LabGroup {
  name: string;
  points: LabPoint[];
}

interface Props {
  patientId: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDateFull(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

type TrendDir = "up" | "down" | "stable";

function trend(values: number[]): TrendDir {
  if (values.length < 2) return "stable";
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const diff = Math.abs(last - prev);
  const pct = diff / (Math.abs(prev) || 1);
  if (pct < 0.03) return "stable";
  return last > prev ? "up" : "down";
}

function TrendBadge({ dir, label }: { dir: TrendDir; label?: string }) {
  const map = {
    up: { icon: <TrendingUp className="w-3 h-3" />, cls: "bg-red-50 text-red-700 border-red-200" },
    down: { icon: <TrendingDown className="w-3 h-3" />, cls: "bg-blue-50 text-blue-700 border-blue-200" },
    stable: { icon: <Minus className="w-3 h-3" />, cls: "bg-green-50 text-green-700 border-green-200" },
  };
  const { icon, cls } = map[dir];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] border px-1.5 py-0.5 rounded-full ${cls}`}>
      {icon}{label ?? (dir === "up" ? "Hausse" : dir === "down" ? "Baisse" : "Stable")}
    </span>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded-md shadow-lg px-3 py-2 text-xs space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-mono font-bold">{p.value}</span></p>
      ))}
    </div>
  );
}

// ─── Single vital chart ───────────────────────────────────────────────────────

interface VitalChartProps {
  title: string;
  data: VitalPoint[];
  dataKey: string;
  unit: string;
  color: string;
  normalMin?: number;
  normalMax?: number;
  dangerMin?: number;
  dangerMax?: number;
  secondKey?: string;
  secondColor?: string;
  secondLabel?: string;
}

function VitalChart({ title, data, dataKey, unit, color, normalMin, normalMax, dangerMin, dangerMax, secondKey, secondColor, secondLabel }: VitalChartProps) {
  const values = data.map(d => d[dataKey] as number).filter(v => v !== undefined);
  const secondValues = secondKey ? data.map(d => d[secondKey!] as number).filter(v => v !== undefined) : [];
  const allValues = [...values, ...secondValues];

  if (data.length < 2) {
    const last = data[0];
    if (!last) return null;
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-1">{title}</p>
          <p className="text-2xl font-bold">{last[dataKey] as number} <span className="text-sm font-normal text-muted-foreground">{unit}</span></p>
          {secondKey && last[secondKey!] !== undefined && (
            <p className="text-sm text-muted-foreground">{secondLabel}: {last[secondKey!] as number}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">{fmtDateFull(last.date)}</p>
          <p className="text-[11px] text-blue-600 mt-1">1 mesure — pas assez pour une courbe</p>
        </CardContent>
      </Card>
    );
  }

  const lastVal = values[values.length - 1];
  const trendDir = trend(values);
  const yMin = Math.max(0, Math.min(...allValues) - 10);
  const yMax = Math.max(...allValues) + 10;
  const lastDate = fmtDateFull(data[data.length - 1].date);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
          <span>{title}</span>
          <div className="flex items-center gap-2">
            <TrendBadge dir={trendDir} />
            <span className="text-xs text-muted-foreground font-normal">Dernière: {lastVal} {unit} — {lastDate}</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
            <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10 }} />
            <Tooltip content={<CustomTooltip />} />
            {normalMin !== undefined && normalMax !== undefined && (
              <ReferenceArea y1={normalMin} y2={normalMax} fill="#22c55e" fillOpacity={0.08} />
            )}
            {dangerMin !== undefined && (
              <ReferenceLine y={dangerMin} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.5} />
            )}
            {dangerMax !== undefined && (
              <ReferenceLine y={dangerMax} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.5} />
            )}
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 4, fill: color }}
              activeDot={{ r: 6 }}
              name={title}
            />
            {secondKey && (
              <Line
                type="monotone"
                dataKey={secondKey}
                stroke={secondColor || "#94a3b8"}
                strokeWidth={2}
                dot={{ r: 4, fill: secondColor || "#94a3b8" }}
                activeDot={{ r: 6 }}
                name={secondLabel || secondKey}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─── Lab trends chart ─────────────────────────────────────────────────────────

function LabChart({ group }: { group: LabGroup }) {
  if (group.points.length < 2) {
    const pt = group.points[0];
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-1">{group.name}</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold">{pt.value}</p>
            {pt.normal !== null && (
              <Badge variant="outline" className={pt.normal ? "text-green-700 border-green-400" : "text-red-700 border-red-400"}>
                {pt.normal ? "Normal" : "Anormal"}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{fmtDateFull(pt.date)}</p>
          <p className="text-[11px] text-blue-600 mt-1">1 mesure — pas assez pour une courbe</p>
        </CardContent>
      </Card>
    );
  }

  const values = group.points.map(p => p.value);
  const trendDir = trend(values);
  const lastPt = group.points[group.points.length - 1];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
          <span>{group.name}</span>
          <div className="flex items-center gap-2">
            <TrendBadge dir={trendDir} />
            {lastPt.normal !== null && (
              <Badge variant="outline" className={lastPt.normal ? "text-green-700 border-green-400 text-[10px]" : "text-red-700 border-red-400 text-[10px]"}>
                {lastPt.normal ? "Normal" : "Anormal"}
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={group.points} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={(props) => {
              const { cx, cy, payload } = props;
              const fill = payload.normal === false ? "#ef4444" : "#6366f1";
              return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={fill} stroke="white" strokeWidth={1} />;
            }} name={group.name} />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-muted-foreground">Dernière: {lastPt.value} — {fmtDateFull(lastPt.date)}</p>
      </CardContent>
    </Card>
  );
}

// ─── BMI badge ────────────────────────────────────────────────────────────────

function imcBadge(imc: number) {
  if (imc < 18.5) return { label: "Maigreur", cls: "bg-blue-50 text-blue-700 border-blue-300" };
  if (imc < 25) return { label: "Normal", cls: "bg-green-50 text-green-700 border-green-300" };
  if (imc < 30) return { label: "Surpoids", cls: "bg-orange-50 text-orange-700 border-orange-300" };
  return { label: "Obésité", cls: "bg-red-50 text-red-700 border-red-300" };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VitalSignsTrends({ patientId }: Props) {
  const { t } = useLang();
  const [consultations, setConsultations] = useState<Consultation[]>([]);

  useEffect(() => {
    db.consultations
      .where("patientId").equals(patientId)
      .sortBy("date")
      .then(all => setConsultations(all.filter(c => c.isLatest !== false && c.vitals)));
  }, [patientId]);

  const { vitalData, labGroups, imcData } = useMemo(() => {
    const sorted = [...consultations].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Vital data points
    const vd: VitalPoint[] = [];
    sorted.forEach(c => {
      const v = c.vitals;
      if (!v) return;
      const point: VitalPoint = {
        date: c.date,
        dateLabel: fmtDate(c.date),
        doctor: c.editedBy || "",
      };
      // Systolic / Diastolic from "120/80" format
      if (v.bp) {
        const parts = v.bp.split("/");
        if (parts.length === 2) {
          const sys = parseInt(parts[0]);
          const dia = parseInt(parts[1]);
          if (!isNaN(sys)) point.systolic = sys;
          if (!isNaN(dia)) point.diastolic = dia;
        }
      }
      if (v.temperature !== undefined) point.temperature = v.temperature;
      if (v.pulse !== undefined) point.pulse = v.pulse;
      if (v.spo2 !== undefined) point.spo2 = v.spo2;
      if (v.weight !== undefined) point.weight = v.weight;
      if (v.bmi !== undefined) point.bmi = v.bmi;
      vd.push(point);
    });

    // Lab data from paraclinical stored in notes JSON
    const labMap: Record<string, LabPoint[]> = {};
    sorted.forEach(c => {
      let obs: { paraclinical?: Array<{ name: string; result?: string; normal?: boolean | null }> } = {};
      try { if (c.notes?.startsWith("{")) obs = JSON.parse(c.notes); } catch { /* */ }
      if (!obs.paraclinical?.length) return;
      obs.paraclinical.forEach(p => {
        if (!p.result) return;
        const numVal = parseFloat(p.result.replace(/[^0-9.-]/g, ""));
        if (isNaN(numVal)) return;
        if (!labMap[p.name]) labMap[p.name] = [];
        labMap[p.name].push({
          date: c.date,
          dateLabel: fmtDate(c.date),
          value: numVal,
          normal: p.normal ?? null,
        });
      });
    });

    const labGroups: LabGroup[] = Object.entries(labMap)
      .filter(([, pts]) => pts.length >= 1)
      .map(([name, points]) => ({ name, points }))
      .sort((a, b) => b.points.length - a.points.length);

    // IMC data with zone info
    const imcData = vd.filter(d => d.bmi !== undefined);

    return { vitalData: vd, labGroups, imcData };
  }, [consultations]);

  const bpData = vitalData.filter(d => d.systolic !== undefined);
  const tempData = vitalData.filter(d => d.temperature !== undefined);
  const pulseData = vitalData.filter(d => d.pulse !== undefined);
  const spo2Data = vitalData.filter(d => d.spo2 !== undefined);
  const weightData = vitalData.filter(d => d.weight !== undefined);

  if (consultations.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm space-y-2">
        <p className="text-3xl">📈</p>
        <p>Aucune constante enregistrée.</p>
        <p className="text-xs">Les courbes apparaissent dès qu'au moins une consultation inclut des signes vitaux.</p>
      </div>
    );
  }

  const hasAny = bpData.length > 0 || tempData.length > 0 || pulseData.length > 0 || spo2Data.length > 0 || weightData.length > 0;

  return (
    <div className="space-y-4">
      {!hasAny && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <p>Constantes enregistrées mais sans valeurs numériques exploitables.</p>
        </div>
      )}

      <div className="grid gap-4">
        {/* ── Blood Pressure ── */}
        {bpData.length > 0 && (
          <VitalChart
            title="Tension artérielle (mmHg)"
            data={bpData}
            dataKey="systolic"
            unit="mmHg"
            color="#ef4444"
            secondKey="diastolic"
            secondColor="#f97316"
            secondLabel="Diastolique"
            normalMin={60}
            normalMax={90}
            dangerMin={140}
          />
        )}

        {/* ── Temperature ── */}
        {tempData.length > 0 && (
          <VitalChart
            title="Température (°C)"
            data={tempData}
            dataKey="temperature"
            unit="°C"
            color="#f97316"
            normalMin={36.5}
            normalMax={37.5}
            dangerMin={38.5}
          />
        )}

        {/* ── Pulse ── */}
        {pulseData.length > 0 && (
          <VitalChart
            title="Fréquence cardiaque (bpm)"
            data={pulseData}
            dataKey="pulse"
            unit="bpm"
            color="#3b82f6"
            normalMin={60}
            normalMax={100}
          />
        )}

        {/* ── SpO2 ── */}
        {spo2Data.length > 0 && (
          <VitalChart
            title="SpO₂ (%)"
            data={spo2Data}
            dataKey="spo2"
            unit="%"
            color="#22c55e"
            normalMin={95}
            normalMax={100}
            dangerMax={95}
          />
        )}

        {/* ── Weight ── */}
        {weightData.length > 0 && (
          <VitalChart
            title="Poids (kg)"
            data={weightData}
            dataKey="weight"
            unit="kg"
            color="#8b5cf6"
          />
        )}

        {/* ── IMC ── */}
        {imcData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
                <span>IMC</span>
                {imcData.length >= 2 && (
                  <TrendBadge dir={trend(imcData.map(d => d.bmi as number))} />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {imcData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={imcData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceArea y1={18.5} y2={25} fill="#22c55e" fillOpacity={0.08} />
                    <Line type="monotone" dataKey="bmi" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} name="IMC" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-2xl font-bold">{imcData[0].bmi}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                {(() => {
                  const lastBmi = imcData[imcData.length - 1].bmi as number;
                  const { label, cls } = imcBadge(lastBmi);
                  return (
                    <>
                      <Badge variant="outline" className={`text-xs ${cls}`}>{label}</Badge>
                      <span className="text-[11px] text-muted-foreground">IMC: {lastBmi} — {fmtDateFull(imcData[imcData.length - 1].date)}</span>
                    </>
                  );
                })()}
              </div>
              {imcData.length < 2 && <p className="text-[11px] text-blue-600 mt-1">1 mesure — pas assez pour une courbe</p>}
            </CardContent>
          </Card>
        )}

        {/* ── Lab results ── */}
        {labGroups.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Résultats paracliniques</h3>
            {labGroups.map(g => <LabChart key={g.name} group={g} />)}
          </div>
        )}
      </div>
    </div>
  );
}
