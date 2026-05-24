import React, { useEffect, useState, useCallback } from "react";
import { db, type Appointment, type Patient, type User, type AppointmentStatus, type ReminderOffset } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, ChevronLeft, ChevronRight, Settings2, Trash2, Check, Search, FileText, Bold, Italic, List, Phone } from "lucide-react";
import { toast } from "sonner";
import { decryptPatients } from "@/lib/patientCrypto";
import { RemindersPanel, type ReminderContext } from "@/components/RemindersPanel";
import { scheduleReminder, isSubscribed } from "@/lib/pushNotifications";
import { getClinicId, getClinicSettings } from "@/lib/clinicSettings";

const STATUS_FLOW: AppointmentStatus[] = ["scheduled", "confirmed", "arrived", "in_consultation", "completed", "cancelled", "noshow"];

const statusColors: Record<AppointmentStatus, string> = {
  scheduled: "bg-info text-info-foreground",
  confirmed: "bg-primary text-primary-foreground",
  arrived: "bg-accent text-accent-foreground",
  in_consultation: "bg-warning text-warning-foreground",
  completed: "bg-success text-success-foreground",
  cancelled: "bg-muted text-muted-foreground",
  noshow: "bg-destructive text-destructive-foreground",
};

/* ---- Local notification helper ---- */
async function scheduleLocalNotification(date: string, time: string, offset: ReminderOffset, patientName: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission !== "granted") return;

  const apptTime = new Date(`${date}T${time}`);
  const offsets: Record<ReminderOffset, number> = { "15min": 15 * 60_000, "30min": 30 * 60_000, "1h": 3600_000, "1day": 86400_000 };
  const notifyAt = apptTime.getTime() - offsets[offset];
  const delay = notifyAt - Date.now();
  if (delay <= 0) return;

  setTimeout(() => {
    new Notification("DivineLink Rappel", { body: `RDV ${patientName} dans ${offset === "1day" ? "1 jour" : offset}`, icon: "/placeholder.svg" });
  }, delay);
}

/* ---- Tasks (localStorage) ---- */
interface Task { id: string; text: string; done: boolean; postponed?: boolean; date: string; }

const TASKS_KEY = "divinelink.tasks";

function loadTasks(): Task[] {
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || "[]"); } catch { return []; }
}

function saveTasks(tasks: Task[]) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function carryOverTasks(today: string) {
  const tasks = loadTasks();
  let changed = false;
  tasks.forEach(t => {
    if (t.date !== today && !t.done) {
      t.postponed = true;
      t.date = today;
      changed = true;
    }
  });
  if (changed) saveTasks(tasks);
}

/* ---- Notes (localStorage) ---- */
interface Note { id: string; title: string; content: string; createdAt: string; updatedAt: string; }

const NOTES_KEY = "divinelink.notes";

function loadNotes(): Note[] {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || "[]"); } catch { return []; }
}

function saveNotes(notes: Note[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

/* ============================================================ */
export function AgendaPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [tab, setTab] = useState("appointments");

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList className="grid grid-cols-3 w-full">
        <TabsTrigger value="appointments">{t("agenda.tab.appointments")}</TabsTrigger>
        <TabsTrigger value="tasks">{t("agenda.tab.tasks")}</TabsTrigger>
        <TabsTrigger value="notes">{t("agenda.tab.notes")}</TabsTrigger>
      </TabsList>

      <TabsContent value="appointments"><AppointmentsTab /></TabsContent>
      <TabsContent value="tasks"><TasksTab /></TabsContent>
      <TabsContent value="notes"><NotesTab /></TabsContent>
    </Tabs>
  );
}

/* ============ TAB 1: Rendez-vous ============ */
function AppointmentsTab() {
  const { user } = useAuth();
  const { t } = useLang();
  const [appointments, setAppointments] = useState<(Appointment & { patientName: string; doctorName: string; patientPhone: string; doctorPhone: string })[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<User[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ patientId: "", doctorId: "", date: "", time: "", reason: "", status: "scheduled" as AppointmentStatus, reminder: false, reminderOffset: "30min" as ReminderOffset });
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderCtx, setReminderCtx] = useState<ReminderContext | null>(null);

  const load = async () => {
    const allPatients = await decryptPatients(await db.patients.toArray());
    const allDoctors = await db.users.where("role").anyOf(["doctor", "admin"]).toArray();
    setPatients(allPatients);
    setDoctors(allDoctors);

    let appts = await db.appointments.where("date").equals(selectedDate).toArray();
    if (user?.role === "doctor") appts = appts.filter(a => a.doctorId === user.id);

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
    setForm({ patientId: "", doctorId: user?.id?.toString() || "", date: selectedDate, time: "09:00", reason: "", status: "scheduled", reminder: false, reminderOffset: "30min" });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.patientId || !form.doctorId || !form.date) return;
    const now = new Date().toISOString();
    const patientIdNum = parseInt(form.patientId);
    const doctorIdNum = parseInt(form.doctorId);
    const apptId = await db.appointments.add({
      patientId: patientIdNum,
      doctorId: doctorIdNum,
      date: form.date,
      time: form.time,
      reason: form.reason,
      status: form.status,
      reminder: form.reminder,
      reminderOffset: form.reminder ? form.reminderOffset : undefined,
      createdAt: now,
      updatedAt: now,
    }) as number;
    if (form.reminder) {
      const pat = patients.find(p => p.id === patientIdNum);
      const doc = doctors.find(d => d.id === doctorIdNum);
      const patName = pat ? `${pat.firstName} ${pat.lastName}` : "Patient";
      scheduleLocalNotification(form.date, form.time, form.reminderOffset, patName);
      // Schedule push reminder if push notifications are enabled
      const pushActive = await isSubscribed();
      if (pushActive && apptId) {
        const ok = await scheduleReminder({
          appointmentId: apptId,
          clinicId: getClinicId(),
          patientName: patName,
          doctorName: doc?.name || "",
          appointmentDate: form.date,
          appointmentTime: form.time,
          reason: form.reason,
          reminderOffset: form.reminderOffset,
        });
        if (ok) toast.success(t("push.reminderScheduled"));
      }
    }
    toast.success(t("apt.create"));
    setDialogOpen(false);
    load();
  };

  const updateStatus = async (id: number, status: AppointmentStatus) => {
    await db.appointments.update(id, { status, updatedAt: new Date().toISOString() });
    load();
  };

  const sendWhatsApp = (a: typeof appointments[number], target: "patient" | "doctor") => {
    const phoneRaw = target === "patient" ? a.patientPhone : a.doctorPhone;
    if (!phoneRaw) { toast.error(t("wa.noPhone")); return; }
    const clinicName = getClinicSettings()?.name || "DivineLink";
    const patientName = a.patientName.trim() || "Patient";
    const msg = target === "patient"
      ? `${clinicName} - Rappel RDV\nBonjour ${patientName},\nVotre rendez-vous est le ${a.date} à ${a.time} avec Dr. ${a.doctorName}.\nMotif : ${a.reason || "—"}.`
      : `${clinicName} - Rappel RDV\nBonjour Dr. ${a.doctorName},\nVous avez un RDV avec ${patientName} le ${a.date} à ${a.time}.\nMotif : ${a.reason || "—"}.`;
    const digits = phoneRaw.replace(/[^\d]/g, "");
    const phone = digits.startsWith("237") ? digits : `237${digits.replace(/^0/, "")}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const openReminders = (a: typeof appointments[number]) => {
    setReminderCtx({ patientName: a.patientName.trim() || "—", patientPhone: a.patientPhone || "", doctorName: a.doctorName || "—", doctorPhone: a.doctorPhone || "", date: a.date, time: a.time, reason: a.reason || "—" });
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
        {!isToday && <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}>{t("apt.today")}</Button>}
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
                  <p className="text-sm text-muted-foreground truncate">{a.reason || "—"} - Dr. {a.doctorName}</p>
                  {a.reminder && <p className="text-xs text-info">{t("apt.reminder")}: {t(`apt.${a.reminderOffset || "30min"}`)}</p>}
                </div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-success border-success/30 hover:bg-success/10 text-xs"
                    onClick={() => sendWhatsApp(a, "patient")}
                    title={t("wa.patient")}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Rappeler
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-primary border-primary/30 hover:bg-primary/10 text-xs"
                    onClick={() => sendWhatsApp(a, "doctor")}
                    title={t("wa.doctor")}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Dr.
                  </Button>
                  <Button variant="ghost" size="icon" className="text-muted-foreground h-8 w-8" onClick={() => openReminders(a)} title={t("reminder.open")}>
                    <Settings2 className="w-3.5 h-3.5" />
                  </Button>
                  <Select value={a.status} onValueChange={v => updateStatus(a.id!, v as AppointmentStatus)}>
                    <SelectTrigger className="w-auto"><Badge className={statusColors[a.status]}>{t(`apt.${a.status}`)}</Badge></SelectTrigger>
                    <SelectContent>
                      {STATUS_FLOW.map(s => <SelectItem key={s} value={s}>{t(`apt.${s}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("apt.create")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("apt.patient")} *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
                <SelectContent>{patients.map(p => <SelectItem key={p.id} value={p.id!.toString()}>{p.firstName} {p.lastName} ({p.patientId})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>{t("apt.doctor")} *</Label>
              <Select value={form.doctorId} onValueChange={v => setForm(f => ({ ...f, doctorId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{doctors.map(d => <SelectItem key={d.id} value={d.id!.toString()}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("apt.date")} *</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>{t("apt.time")}</Label><Input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} /></div>
            </div>
            <div><Label>{t("apt.reason")}</Label><Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
            <div className="flex items-center gap-3 border rounded-md p-3">
              <Switch checked={form.reminder} onCheckedChange={v => setForm(f => ({ ...f, reminder: v }))} />
              <Label className="flex-1">{t("apt.reminder")}</Label>
              {form.reminder && (
                <Select value={form.reminderOffset} onValueChange={v => setForm(f => ({ ...f, reminderOffset: v as ReminderOffset }))}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15min">{t("apt.15min")}</SelectItem>
                    <SelectItem value="30min">{t("apt.30min")}</SelectItem>
                    <SelectItem value="1h">{t("apt.1h")}</SelectItem>
                    <SelectItem value="1day">{t("apt.1day")}</SelectItem>
                  </SelectContent>
                </Select>
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

/* ============ TAB 2: Tâches du jour ============ */
function TasksTab() {
  const { t } = useLang();
  const today = new Date().toISOString().split("T")[0];
  const [tasks, setTasks] = useState<Task[]>(() => { carryOverTasks(today); return loadTasks().filter(t => t.date === today); });
  const [input, setInput] = useState("");

  const addTask = () => {
    if (!input.trim()) return;
    const next: Task = { id: crypto.randomUUID(), text: input.trim(), done: false, date: today };
    const all = [...loadTasks().filter(t => t.date !== today), ...tasks, next];
    saveTasks(all);
    setTasks(prev => [...prev, next]);
    setInput("");
  };

  const toggleTask = (id: string) => {
    const updated = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated);
    const all = [...loadTasks().filter(t => t.date !== today), ...updated];
    saveTasks(all);
  };

  const deleteTask = (id: string) => {
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    const all = [...loadTasks().filter(t => t.date !== today), ...updated];
    saveTasks(all);
  };

  const pending = tasks.filter(t => !t.done);
  const completed = tasks.filter(t => t.done);

  return (
    <div className="space-y-4">
      <form onSubmit={e => { e.preventDefault(); addTask(); }} className="flex gap-2">
        <Input placeholder={t("agenda.taskPlaceholder")} value={input} onChange={e => setInput(e.target.value)} className="flex-1" />
        <Button type="submit" size="icon"><Plus className="w-4 h-4" /></Button>
      </form>

      {pending.length === 0 && completed.length === 0 && (
        <p className="text-muted-foreground text-center py-8">{t("common.noData")}</p>
      )}

      <div className="space-y-2">
        {pending.map(task => (
          <div key={task.id} className="flex items-center gap-3 border rounded-md p-3">
            <button onClick={() => toggleTask(task.id)} className="w-5 h-5 rounded border-2 border-muted-foreground/30 flex items-center justify-center flex-shrink-0">
              {task.done && <Check className="w-3 h-3" />}
            </button>
            <span className="flex-1 text-sm">{task.text}</span>
            {task.postponed && <Badge variant="outline" className="text-warning text-[10px]">{t("agenda.postponed")}</Badge>}
            <Button variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => deleteTask(task.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
      </div>

      {completed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">{t("apt.completed")}</p>
          {completed.map(task => (
            <div key={task.id} className="flex items-center gap-3 border rounded-md p-3 opacity-60">
              <button onClick={() => toggleTask(task.id)} className="w-5 h-5 rounded border-2 border-primary bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3" />
              </button>
              <span className="flex-1 text-sm line-through">{task.text}</span>
              <Button variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => deleteTask(task.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ TAB 3: Notes libres ============ */
function NotesTab() {
  const { t } = useLang();
  const [notes, setNotes] = useState<Note[]>(() => loadNotes());
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = notes.filter(n =>
    n.title.toLowerCase().includes(search.toLowerCase()) ||
    n.content.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const addNote = () => {
    const n: Note = { id: crypto.randomUUID(), title: "", content: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setNotes(prev => [n, ...prev]);
    saveNotes([n, ...notes]);
    setEditing(n);
  };

  const updateNote = (patch: Partial<Note>) => {
    if (!editing) return;
    const updated = { ...editing, ...patch, updatedAt: new Date().toISOString() };
    setEditing(updated);
    const next = notes.map(n => n.id === updated.id ? updated : n);
    setNotes(next);
    saveNotes(next);
  };

  const closeEdit = () => {
    setEditing(null);
  };

  const confirmDelete = (id: string) => {
    const next = notes.filter(n => n.id !== id);
    setNotes(next);
    saveNotes(next);
    if (editing?.id === id) setEditing(null);
    setDeleteConfirm(null);
  };

  const wrapSelection = (prefix: string, suffix: string) => {
    const ta = document.getElementById("note-editor") as HTMLTextAreaElement | null;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = editing?.content || "";
    const selected = val.substring(start, end);
    const replaced = prefix + selected + suffix;
    const newContent = val.substring(0, start) + replaced + val.substring(end);
    updateNote({ content: newContent });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t("agenda.searchNotes")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={addNote} className="gap-2"><Plus className="w-4 h-4" />{t("agenda.addNote")}</Button>
      </div>

      {editing && (
        <Card className="p-4 space-y-3 border-primary">
          <Input value={editing.title} onChange={e => updateNote({ title: e.target.value })} placeholder={t("agenda.noteTitle")} className="font-semibold" />
          <div className="flex gap-1 border-b pb-2">
            <Button size="sm" variant="ghost" onClick={() => wrapSelection("**", "**")}><Bold className="w-4 h-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => wrapSelection("_", "_")}><Italic className="w-4 h-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => wrapSelection("- ", "")}><List className="w-4 h-4" /></Button>
          </div>
          <textarea
            id="note-editor"
            value={editing.content}
            onChange={e => updateNote({ content: e.target.value })}
            placeholder={t("agenda.noteContent")}
            className="w-full min-h-[200px] text-sm bg-transparent border-0 focus:outline-none resize-y"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{new Date(editing.updatedAt).toLocaleString()}</span>
            <Button size="sm" variant="ghost" onClick={closeEdit}>{t("common.back")}</Button>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">{t("common.noData")}</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map(n => (
            <Card key={n.id} className={`p-3 cursor-pointer hover:shadow-sm transition-shadow ${editing?.id === n.id ? "border-primary" : ""}`} onClick={() => setEditing(n)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{n.title || t("agenda.noteTitle")}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{n.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.updatedAt).toLocaleString()}</p>
                </div>
                <Button variant="ghost" size="icon" className="text-destructive h-7 w-7 flex-shrink-0" onClick={e => { e.stopPropagation(); setDeleteConfirm(n.id); }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("agenda.deleteNote")}</DialogTitle></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && confirmDelete(deleteConfirm)}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
