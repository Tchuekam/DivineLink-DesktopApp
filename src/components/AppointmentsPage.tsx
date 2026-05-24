import React, { useEffect, useState } from "react";
import { db, type Appointment, type Patient, type User, type AppointmentStatus } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, ChevronLeft, ChevronRight, Upload, Paperclip, MessageCircle, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { compressImage, fileToDataUrl } from "@/lib/imageUtils";
import { decryptPatients } from "@/lib/patientCrypto";
import { RemindersPanel, type ReminderContext } from "@/components/RemindersPanel";

const statusColors: Record<AppointmentStatus, string> = {
  scheduled: "bg-info text-info-foreground",
  confirmed: "bg-info text-info-foreground",
  arrived: "bg-warning text-warning-foreground",
  in_consultation: "bg-primary text-primary-foreground",
  completed: "bg-success text-success-foreground",
  cancelled: "bg-muted text-muted-foreground",
  noshow: "bg-destructive text-destructive-foreground",
};

export function AppointmentsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [appointments, setAppointments] = useState<(Appointment & { patientName: string; doctorName: string; patientPhone: string; doctorPhone: string })[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<User[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ patientId: "", doctorId: "", date: "", time: "", reason: "", status: "scheduled" as AppointmentStatus });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderCtx, setReminderCtx] = useState<ReminderContext | null>(null);

  const load = async () => {
    const allPatients = await decryptPatients(await db.patients.toArray());
    const allDoctors = await db.users.where("role").anyOf(["doctor", "admin"]).toArray();
    setPatients(allPatients);
    setDoctors(allDoctors);

    let appts = await db.appointments.where("date").equals(selectedDate).toArray();
    if (user?.role === "doctor") {
      appts = appts.filter(a => a.doctorId === user.id);
    }

    const enriched = appts.map(a => {
      const pat = allPatients.find(p => p.id === a.patientId);
      const doc = allDoctors.find(d => d.id === a.doctorId);
      return {
        ...a,
        patientName: (pat?.firstName || "") + " " + (pat?.lastName || ""),
        patientPhone: pat?.phone || "",
        doctorName: doc?.name || "—",
        doctorPhone: doc?.phone || "",
      };
    }).sort((a, b) => a.time.localeCompare(b.time));

    setAppointments(enriched);
  };

  useEffect(() => { load(); }, [selectedDate]);

  const shiftDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  const openNew = () => {
    setForm({ patientId: "", doctorId: user?.id?.toString() || "", date: selectedDate, time: "09:00", reason: "", status: "scheduled" });
    setPendingFiles([]);
    setDialogOpen(true);
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPendingFiles(prev => [...prev, ...files]);
    e.target.value = "";
  };

  const save = async () => {
    if (!form.patientId || !form.doctorId || !form.date) return;
    const now = new Date().toISOString();
    const patientIdNum = parseInt(form.patientId);
    await db.appointments.add({
      patientId: patientIdNum,
      doctorId: parseInt(form.doctorId),
      date: form.date,
      time: form.time,
      reason: form.reason,
      status: form.status,
      createdAt: now,
      updatedAt: now,
    });
    // Save attachments to documents table linked to the patient
    for (const file of pendingFiles) {
      try {
        const data = file.type.startsWith("image/") ? await compressImage(file) : await fileToDataUrl(file);
        await db.documents.add({
          patientId: patientIdNum,
          name: file.name,
          type: file.type || "application/octet-stream",
          data,
          size: file.size,
          tag: "referral",
          createdAt: now,
        });
      } catch {
        toast.error(`Upload failed: ${file.name}`);
      }
    }
    toast.success(t("apt.create"));
    setPendingFiles([]);
    setDialogOpen(false);
    load();
  };

  const updateStatus = async (id: number, status: AppointmentStatus) => {
    await db.appointments.update(id, { status, updatedAt: new Date().toISOString() });
    load();
  };

  const sendWhatsApp = (a: typeof appointments[number], target: "patient" | "doctor") => {
    const phoneRaw = target === "patient" ? a.patientPhone : a.doctorPhone;
    if (!phoneRaw) {
      toast.error(t("wa.noPhone"));
      return;
    }
    const msg = t("wa.message")
      .replace("{date}", a.date)
      .replace("{time}", a.time)
      .replace("{doctor}", a.doctorName)
      .replace("{reason}", a.reason || "—");
    const phone = phoneRaw.replace(/[^\d+]/g, "").replace(/^\+/, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const openReminders = (a: typeof appointments[number]) => {
    setReminderCtx({
      patientName: a.patientName.trim() || "—",
      patientPhone: a.patientPhone || "",
      doctorName: a.doctorName || "—",
      doctorPhone: a.doctorPhone || "",
      date: a.date,
      time: a.time,
      reason: a.reason || "—",
    });
    setReminderOpen(true);
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => shiftDate(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-auto" />
          <Button variant="outline" size="icon" onClick={() => shiftDate(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        {!isToday && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}>
            {t("apt.today")}
          </Button>
        )}
        <div className="flex-1" />
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" />{t("apt.create")}</Button>
      </div>

      {appointments.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">{t("common.noData")}</p>
      ) : (
        <div className="grid gap-3">
          {appointments.map(a => (
            <Card key={a.id}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="text-center min-w-[48px]">
                  <p className="text-lg font-bold text-primary">{a.time}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{a.patientName}</p>
                  <p className="text-sm text-muted-foreground truncate">{a.reason || "—"} • Dr. {a.doctorName}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("wa.remind")}
                      aria-label={t("wa.remind")}
                      className="text-success"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => sendWhatsApp(a, "patient")}>
                      {t("wa.patient")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => sendWhatsApp(a, "doctor")}>
                      {t("wa.doctor")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openReminders(a)}>
                      <Settings2 className="w-4 h-4 mr-2" />
                      {t("reminder.open")}…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Select value={a.status} onValueChange={(v) => updateStatus(a.id!, v as AppointmentStatus)}>
                  <SelectTrigger className="w-auto">
                    <Badge className={statusColors[a.status]}>{t(`apt.${a.status}`)}</Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {(["scheduled", "completed", "cancelled", "noshow"] as const).map(s => (
                      <SelectItem key={s} value={s}>{t(`apt.${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("apt.create")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("apt.patient")} *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id!.toString()}>{p.firstName} {p.lastName} ({p.patientId})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("apt.doctor")} *</Label>
              <Select value={form.doctorId} onValueChange={v => setForm(f => ({ ...f, doctorId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {doctors.map(d => (
                    <SelectItem key={d.id} value={d.id!.toString()}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("apt.date")} *</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <Label>{t("apt.time")}</Label>
                <Input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>{t("apt.reason")}</Label>
              <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
            </div>
            <div>
              <Label className="flex items-center gap-2"><Paperclip className="w-4 h-4" />Attachments</Label>
              <Button asChild size="sm" variant="outline" type="button" className="mt-1">
                <label className="cursor-pointer">
                  <Upload className="w-4 h-4 mr-2" />
                  Add files
                  <input type="file" multiple className="hidden" onChange={handleFiles} />
                </label>
              </Button>
              {pendingFiles.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {pendingFiles.map((f, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate">{f.name}</span>
                      <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="text-destructive">×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={save}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemindersPanel open={reminderOpen} onOpenChange={setReminderOpen} context={reminderCtx} />
    </div>
  );
}
