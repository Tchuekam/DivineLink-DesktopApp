import React, { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/db";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, CalendarDays, Pill, CreditCard, Database, Check, X, TriangleAlert as AlertTriangle } from "lucide-react";
import type { Page } from "@/components/AppLayout";

interface NotifItem {
  id: string;
  type: string;
  icon: React.ReactNode;
  message: string;
  page: Page;
  urgency: number;
  read: boolean;
}

const READ_KEY = "divinelink.notif.read";
const DISMISSED_KEY = "divinelink.notif.dismissed";

function getReadIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); } catch { return new Set(); }
}
function markRead(id: string) {
  const s = getReadIds(); s.add(id);
  localStorage.setItem(READ_KEY, JSON.stringify([...s]));
}
function getDismissedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); } catch { return new Set(); }
}
function markDismissed(id: string) {
  const s = getDismissedIds(); s.add(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]));
}

export function NotificationBell({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);

  const load = useCallback(async () => {
    const notifs: NotifItem[] = [];
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const twoHoursLater = new Date(now.getTime() + 2 * 3600000);

    // 1. Appointments within 2 hours (high urgency)
    const appts = await db.appointments.where("date").equals(today).toArray();
    let todayApptCount = 0;
    appts.filter(a => a.status !== "completed" && a.status !== "cancelled").forEach(a => {
      todayApptCount++;
      const apptTime = new Date(`${a.date}T${a.time || "00:00"}`);
      if (apptTime <= twoHoursLater && apptTime >= now) {
        notifs.push({
          id: `apt-2h-${a.id}`,
          type: "appointment_urgent",
          icon: <CalendarDays className="w-4 h-4 text-destructive" />,
          message: `${t("notif.appointments2h")}: ${a.time}`,
          page: "appointments",
          urgency: 1,
          read: false,
        });
      }
    });

    // 2. Total appointments today
    if (todayApptCount > 0) {
      notifs.push({
        id: "apt-today",
        type: "appointment_today",
        icon: <CalendarDays className="w-4 h-4 text-primary" />,
        message: `${todayApptCount} ${t("notif.appointmentsToday")}`,
        page: "appointments",
        urgency: 2,
        read: false,
      });
    }

    // 3. Unpaid patients
    const payments = await db.payments.toArray();
    const unpaidByPatient = new Map<number, number>();
    payments.forEach(p => {
      const bal = Math.max(0, (p.amountDue || 0) - (p.amountPaid || 0));
      if (bal > 0) unpaidByPatient.set(p.patientId, (unpaidByPatient.get(p.patientId) || 0) + bal);
    });
    const unpaidCount = unpaidByPatient.size;
    const totalOwed = [...unpaidByPatient.values()].reduce((s, v) => s + v, 0);
    if (unpaidCount > 0) {
      notifs.push({
        id: "unpaid-patients",
        type: "unpaid",
        icon: <CreditCard className="w-4 h-4 text-destructive" />,
        message: `${unpaidCount} ${t("notif.unpaidCount")} — ${totalOwed.toFixed(0)} FCFA ${t("notif.owed")}`,
        page: "payments",
        urgency: 3,
        read: false,
      });
    }

    // 4. Low stock drugs
    const drugs = await db.drugs.toArray();
    const lowStockDrugs = drugs.filter(d => d.status === "low" || d.status === "out");
    if (lowStockDrugs.length > 0) {
      notifs.push({
        id: "low-stock",
        type: "drug",
        icon: <Pill className="w-4 h-4 text-warning" />,
        message: `${lowStockDrugs.length} ${t("notif.lowStock")}`,
        page: "pharmacy",
        urgency: 4,
        read: false,
      });
    }

    // 5. Drugs expiring within 30 days
    const expiringDrugs = drugs.filter(d => {
      if (!d.expiration) return false;
      const days = (new Date(d.expiration).getTime() - Date.now()) / 86400000;
      return days < 30 && days > 0;
    });
    if (expiringDrugs.length > 0) {
      notifs.push({
        id: "expiring-drugs",
        type: "expiring",
        icon: <AlertTriangle className="w-4 h-4 text-warning" />,
        message: `${expiringDrugs.length} ${t("notif.expiring30d")}`,
        page: "pharmacy",
        urgency: 5,
        read: false,
      });
    }

    // 6. Backup overdue >7 days
    const lastSync = localStorage.getItem("dl.sync.lastExport.v1");
    if (!lastSync || (Date.now() - new Date(lastSync).getTime()) > 7 * 86400000) {
      notifs.push({
        id: "backup-overdue",
        type: "backup",
        icon: <Database className="w-4 h-4 text-destructive" />,
        message: t("notif.backup7d"),
        page: "backup",
        urgency: 6,
        read: false,
      });
    }

    // Sort by urgency
    notifs.sort((a, b) => a.urgency - b.urgency);

    // Apply read/dismissed state
    const readIds = getReadIds();
    const dismissedIds = getDismissedIds();
    notifs.forEach(n => { n.read = readIds.has(n.id); });
    const visible = notifs.filter(n => !dismissedIds.has(n.id));

    setItems(visible);
  }, [t]);

  useEffect(() => { load(); const id = setInterval(load, 300000); return () => clearInterval(id); }, [load]);

  const unread = items.filter(i => !i.read).length;

  const handleMarkRead = (id: string) => {
    markRead(id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, read: true } : i));
  };

  const handleDismiss = (id: string) => {
    markDismissed(id);
    markRead(id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleMarkAllRead = () => {
    items.forEach(i => { markRead(i.id); });
    setItems(prev => prev.map(i => ({ ...i, read: true })));
  };

  const handleClick = (n: NotifItem) => {
    handleMarkRead(n.id);
    onNavigate(n.page);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-md hover:bg-accent transition-colors">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center animate-pulse">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="font-semibold text-sm">{t("notif.title")}</span>
          <div className="flex gap-1">
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-6" onClick={handleMarkAllRead}>
                <Check className="w-3 h-3 mr-1" />{t("notif.markAllRead")}
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("notif.noAlerts")}</p>
          ) : (
            items.map(n => (
              <div
                key={n.id}
                className={`w-full text-left p-3 border-b last:border-0 hover:bg-accent/50 transition-colors flex items-start gap-2 ${n.read ? "opacity-50" : ""}`}
              >
                <button
                  onClick={() => handleClick(n)}
                  className="flex items-start gap-2 flex-1 min-w-0 text-left"
                >
                  <span className="flex-shrink-0 mt-0.5">{n.icon}</span>
                  <span className="text-sm flex-1">{n.message}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDismiss(n.id); }}
                  className="flex-shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title={t("notif.dismiss")}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
