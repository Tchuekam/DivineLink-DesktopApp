import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Clock, Play, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const CFG_KEY = "divinelink.sync.config";

interface SyncConfig {
  enabled: boolean;
  endpoint: string;
  intervalMin: number;
  adminEmail: string;
  lastRun?: string;
  lastReport?: string;
}

const DEFAULT: SyncConfig = { enabled: false, endpoint: "", intervalMin: 60, adminEmail: "" };

function loadCfg(): SyncConfig {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") }; }
  catch { return DEFAULT; }
}
function saveCfg(c: SyncConfig) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

async function runSyncOnce(cfg: SyncConfig): Promise<string> {
  if (!cfg.endpoint) return "Aucun endpoint configuré.";
  if (!navigator.onLine) return "Hors ligne — synchronisation reportée.";
  try {
    const r = await fetch(cfg.endpoint, { method: "GET" });
    if (!r.ok) return `Erreur HTTP ${r.status}`;
    const txt = await r.text();
    return `OK (${txt.length} octets reçus)`;
  } catch (e: any) {
    return "Erreur réseau: " + (e?.message || e);
  }
}

export function ScheduledSyncPage() {
  const [cfg, setCfg] = useState<SyncConfig>(loadCfg());
  const [running, setRunning] = useState(false);

  useEffect(() => { saveCfg(cfg); }, [cfg]);

  useEffect(() => {
    if (!cfg.enabled) return;
    const id = setInterval(async () => {
      const report = await runSyncOnce(cfg);
      setCfg(c => ({ ...c, lastRun: new Date().toISOString(), lastReport: report }));
    }, Math.max(5, cfg.intervalMin) * 60 * 1000);
    return () => clearInterval(id);
  }, [cfg.enabled, cfg.intervalMin, cfg.endpoint]);

  const runNow = async () => {
    setRunning(true);
    const report = await runSyncOnce(cfg);
    setCfg(c => ({ ...c, lastRun: new Date().toISOString(), lastReport: report }));
    toast.success(report);
    setRunning(false);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Synchronisation planifiée</h2>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" />Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2">
            <Switch checked={cfg.enabled} onCheckedChange={e => setCfg({ ...cfg, enabled: e })} />
            <span className="text-sm">Activer la synchronisation périodique</span>
          </label>
          <div>
            <Label>Endpoint / URL du dossier partagé</Label>
            <Input value={cfg.endpoint} onChange={e => setCfg({ ...cfg, endpoint: e.target.value })} placeholder="https://..." />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Intervalle (min)</Label>
              <Input type="number" min={5} value={cfg.intervalMin} onChange={e => setCfg({ ...cfg, intervalMin: parseInt(e.target.value) || 60 })} />
            </div>
            <div>
              <Label>Email admin (rapport)</Label>
              <Input type="email" value={cfg.adminEmail} onChange={e => setCfg({ ...cfg, adminEmail: e.target.value })} />
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <p>L'application fonctionne hors ligne. La synchronisation ne s'exécute que lorsque l'app est ouverte et qu'une connexion réseau est disponible. Les rapports email nécessitent un service email externe (à configurer côté endpoint).</p>
          </div>
          <Button onClick={runNow} disabled={running || !cfg.endpoint} className="gap-2"><Play className="w-4 h-4" />Lancer maintenant</Button>
        </CardContent>
      </Card>

      {cfg.lastRun && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Dernière exécution</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>{new Date(cfg.lastRun).toLocaleString()}</p>
            <p className="text-muted-foreground">{cfg.lastReport}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
