import React, { useEffect, useState } from "react";
import { db, generatePatientId, generateAnonCode, type Patient } from "@/lib/db";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, TriangleAlert as AlertTriangle, Trash2, Upload, X, Download, Copy, Share2, CalendarPlus, Camera, QrCode, Printer } from "lucide-react";
import { getClinicSettings } from "@/lib/clinicSettings";
import { toast } from "sonner";
import { compressImage } from "@/lib/imageUtils";
import { decryptPatients, encryptPatientForSave } from "@/lib/patientCrypto";
import { saveFile, toCsv, withDateStamp } from "@/lib/download";
import {
  splitFullName, joinFullName, ageFromDob, dobFromAge,
  patientPaymentSummary, paymentBadgeEmoji,
} from "@/lib/patientHelpers";
import { PatientProfile } from "@/components/PatientProfile";

export function PatientsPage() {
  const { t } = useLang();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [profile, setProfile] = useState<Patient | null>(null);
  const [referral, setReferral] = useState<Patient | null>(null);
  const [codeCard, setCodeCard] = useState<Patient | null>(null);
  const [paySummary, setPaySummary] = useState<Record<number, { status: "paid"|"partial"|"unpaid"; balance: number }>>({});
  const [lastVisitMap, setLastVisitMap] = useState<Record<number, { days: number; lastDx: string }>>({});

  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    dob: "",
    age: "",
    address: "",
    medicalAlerts: "",
    photo: "" as string | undefined,
  });

  const load = async () => {
    const all = await db.patients.reverse().toArray();
    const dec = await decryptPatients(all);
    setPatients(dec);
    const summary: Record<number, { status: "paid"|"partial"|"unpaid"; balance: number }> = {};
    const visitMap: Record<number, { days: number; lastDx: string }> = {};
    const allCons = await db.consultations.toArray();
    await Promise.all(dec.map(async p => {
      if (p.id) summary[p.id] = await patientPaymentSummary(p.id);
      if (p.id) {
        const pCons = allCons.filter(c => c.isLatest !== false && c.patientId === p.id).sort((a, b) => b.date.localeCompare(a.date));
        if (pCons.length) {
          const lastDate = new Date(pCons[0].date || pCons[0].createdAt);
          const days = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
          visitMap[p.id] = { days, lastDx: pCons[0].diagnosis || "" };
        } else {
          visitMap[p.id] = { days: 999, lastDx: "" };
        }
      }
    }));
    setPaySummary(summary);
    setLastVisitMap(visitMap);
  };

  useEffect(() => { load(); }, []);

  const filtered = patients.filter(p => {
    const q = search.toLowerCase();
    return p.firstName.toLowerCase().includes(q) || p.lastName.toLowerCase().includes(q) ||
      p.phone.includes(q) || p.patientId.toLowerCase().includes(q) ||
      (p.anonCode || "").toLowerCase().includes(q);
  });

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(t("patient.copied")); }
    catch { toast.error("Copy failed"); }
  };

  const buildReferral = (p: Patient) =>
    `DivineLink Referral\n--------------------\nAnonymous ID: ${p.anonCode || p.patientId}\nMedical alerts: ${p.medicalAlerts || "—"}\nDate: ${new Date().toLocaleDateString()}\n\n(No identifying personal data is shared.)`;

  const openNew = () => {
    setForm({ fullName: "", phone: "", dob: "", age: "", address: "", medicalAlerts: "", photo: "" });
    setDialogOpen(true);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await compressImage(file);
      setForm(f => ({ ...f, photo: data }));
    } catch { toast.error("Image error"); }
    e.target.value = "";
  };

  const save = async () => {
    if (!form.fullName.trim()) { toast.error(t("patient.fullName")); return; }
    const { firstName, lastName } = splitFullName(form.fullName);
    const ageNum = form.age ? parseInt(form.age) : undefined;
    const dob = form.dob || (ageNum !== undefined ? dobFromAge(ageNum) : "");
    const now = new Date().toISOString();
    const payload = await encryptPatientForSave({
      firstName, lastName,
      phone: form.phone, dob, address: form.address,
      medicalAlerts: form.medicalAlerts,
      photo: form.photo || undefined,
      ageYears: ageNum,
    });
    const patientId = await generatePatientId();
    const anonCode = generateAnonCode();
    const cid = localStorage.getItem("divinelink.clinicId") || undefined;
    await db.patients.add({ ...(payload as any), patientId, anonCode, clinicId: cid, createdAt: now, updatedAt: now });
    toast.success(t("patient.register"));
    setDialogOpen(false);
    load();
  };

  const handleDelete = async (id: number) => {
    await db.transaction("rw", [db.patients, db.consultations, db.appointments, db.documents, db.payments], async () => {
      await db.consultations.where("patientId").equals(id).delete();
      await db.appointments.where("patientId").equals(id).delete();
      await db.documents.where("patientId").equals(id).delete();
      await db.payments.where("patientId").equals(id).delete();
      await db.patients.delete(id);
    });
    setDeleteConfirm(null);
    toast.success(t("common.delete"));
    load();
  };

  const exportAll = async () => {
    if (!patients.length) { toast.info(t("download.empty")); return; }
    const rows = patients.map(p => ({
      patientId: p.patientId,
      fullName: joinFullName(p),
      phone: p.phone || "",
      dob: p.dob || "",
      age: p.ageYears ?? ageFromDob(p.dob) ?? "",
      address: p.address || "",
      medicalAlerts: p.medicalAlerts || "",
      createdAt: p.createdAt,
    }));
    const csv = toCsv(rows as unknown as Record<string, unknown>[]);
    const ok = await saveFile(withDateStamp("patients.csv"), csv, "csv");
    if (ok) toast.success(t("download.done"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t("patient.search")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" onClick={exportAll} className="gap-2">
          <Download className="w-4 h-4" /> {t("download.patients")}
        </Button>
        <Button onClick={openNew} className="gap-2">
          <Plus className="w-4 h-4" /> {t("patient.register")}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">{t("patient.noResults")}</p>
      ) : (
        <div className="grid gap-3">
          {filtered.map(p => {
            const ps = p.id ? paySummary[p.id] : undefined;
            const age = p.ageYears ?? ageFromDob(p.dob);
            const lv = p.id ? lastVisitMap[p.id] : undefined;
            const loyaltyColor = !lv || lv.days > 90 ? "bg-destructive" : lv.days > 30 ? "bg-warning" : "bg-success";
            const loyaltyLabel = !lv || lv.days > 90 ? t("loyalty.lost") : lv.days > 30 ? t("loyalty.followUp") : t("loyalty.regular");
            return (
              <Card key={p.id} className="hover:shadow-md transition-shadow">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm cursor-pointer overflow-hidden flex-shrink-0" onClick={() => setProfile(p)}>
                      {p.photo ? (
                        <img src={p.photo} alt={joinFullName(p)} className="w-full h-full object-cover" />
                      ) : (
                        <>{(p.firstName[0] || "").toUpperCase()}{(p.lastName[0] || "").toUpperCase()}</>
                      )}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${loyaltyColor} border-2 border-card`} title={`${loyaltyLabel} (${lv ? lv.days : "?"} ${t("loyalty.daysAgo")})`} />
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setProfile(p)}>
                    <p className="font-medium truncate flex items-center gap-2">
                      {joinFullName(p)}
                      {ps && ps.balance > 0 && <span title={t(`pay.status.${ps.status}`)}>{paymentBadgeEmoji(ps.status)}</span>}
                      {ps && ps.balance === 0 && <span title={t("pay.status.paid")}>{paymentBadgeEmoji("paid")}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.patientId} • {p.phone || "—"}{age !== undefined ? ` • ${age} ${t("patient.years")}` : ""}
                    </p>
                    {p.anonCode && (
                      <div className="flex items-center gap-1 mt-1">
                        <button type="button" className="text-[10px] bg-accent hover:bg-accent/70 px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-1" onClick={(e) => { e.stopPropagation(); setCodeCard(p); }} title="Show code card">
                          <QrCode className="w-3 h-3" />{p.anonCode}
                        </button>
                        <Button variant="ghost" size="icon" className="w-5 h-5" onClick={(e) => { e.stopPropagation(); copyText(p.anonCode!); }}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {(p.medicalAlerts || p.antecedents?.allergies?.some(a => a.severity === "fatal")) && (
                    <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${p.antecedents?.allergies?.some(a => a.severity === "fatal") ? "text-destructive" : "text-warning"}`} />
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setReferral(p)} title={t("patient.referral")}>
                    <Share2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(p.id!)} className="text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New patient — minimal form */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("patient.register")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-muted overflow-hidden flex items-center justify-center text-muted-foreground text-xs">
                {form.photo ? (
                  <img src={form.photo} alt="" className="w-full h-full object-cover" />
                ) : <span>{t("doc.profilePhoto")}</span>}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline" type="button">
                    <label className="cursor-pointer">
                      <Camera className="w-4 h-4 mr-1" />
                      Photo
                      <input type="file" accept="image/*" capture="user" className="hidden" onChange={handlePhotoUpload} />
                    </label>
                  </Button>
                  <Button asChild size="sm" variant="outline" type="button">
                    <label className="cursor-pointer">
                      <Upload className="w-4 h-4 mr-1" />
                      {form.photo ? t("doc.changePhoto") : t("doc.profilePhoto")}
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                    </label>
                  </Button>
                </div>
                {form.photo && (
                  <Button size="sm" variant="ghost" type="button" onClick={() => setForm(f => ({ ...f, photo: "" }))}>
                    <X className="w-4 h-4 mr-1" /> {t("doc.removePhoto")}
                  </Button>
                )}
              </div>
            </div>

            <div>
              <Label>{t("patient.fullName")} *</Label>
              <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("patient.dob")}</Label>
                <Input type="date" value={form.dob} onChange={e => {
                  const dob = e.target.value;
                  const a = ageFromDob(dob);
                  setForm(f => ({ ...f, dob, age: a !== undefined ? String(a) : f.age }));
                }} />
              </div>
              <div>
                <Label>{t("patient.age")} ({t("patient.years")})</Label>
                <Input type="number" min={0} max={150} value={form.age} onChange={e => setForm(f => ({ ...f, age: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>{t("patient.phone")}</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>{t("patient.address")}</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <Label>{t("patient.alerts")}</Label>
              <Textarea value={form.medicalAlerts} onChange={e => setForm(f => ({ ...f, medicalAlerts: e.target.value }))} placeholder="Allergies, conditions..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={save}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Profile dialog */}
      {profile && (
        <PatientProfile patient={profile} open={!!profile} onClose={() => setProfile(null)} onChanged={load} />
      )}

      {/* Delete confirmation */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("patient.confirmDelete")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            {t("patient.deleteWarning")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Referral card */}
      <Dialog open={!!referral} onOpenChange={() => setReferral(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("patient.referral")}</DialogTitle></DialogHeader>
          {referral && (
            <>
              <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap font-mono">{buildReferral(referral)}</pre>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReferral(null)}>{t("common.cancel")}</Button>
                <Button onClick={() => copyText(buildReferral(referral))} className="gap-2">
                  <Copy className="w-4 h-4" />{t("patient.referralCopy")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Patient code card */}
      <Dialog open={!!codeCard} onOpenChange={() => setCodeCard(null)}>
        <DialogContent className="max-w-sm print:shadow-none">
          <DialogHeader><DialogTitle>Patient Code Card</DialogTitle></DialogHeader>
          {codeCard && (
            <div id="code-card-print" className="border-2 border-primary rounded-xl p-6 bg-white text-center space-y-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{getClinicSettings()?.name || "DivineLink Clinic"}</p>
              <p className="font-mono font-bold text-3xl tracking-wider text-primary break-all">{codeCard.anonCode || codeCard.patientId}</p>
              <div className="flex justify-center items-end gap-[2px] h-12 px-2" aria-hidden>
                {(codeCard.anonCode || codeCard.patientId).split("").map((ch, i) => {
                  const v = (ch.charCodeAt(0) % 5) + 1;
                  return <span key={i} className="bg-black" style={{ width: 3 + (v % 3), height: 20 + v * 5 }} />;
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">Présentez cette carte lors de vos visites · No personal data shown</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCodeCard(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => window.print()} className="gap-2"><Printer className="w-4 h-4" />Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
