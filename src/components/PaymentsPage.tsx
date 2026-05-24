import React, { useEffect, useState, useMemo } from "react";
import { db, type Payment, type PaymentStatus, type PaymentMethod, type PaymentInstallment } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/audit";
import { decryptPatients } from "@/lib/patientCrypto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CreditCard, Plus, Search, TrendingUp, CircleAlert as AlertCircle, CircleCheck as CheckCircle, Clock, Download, Eye, Trash2, CirclePlus as PlusCircle } from "lucide-react";
import { saveFile, toCsv, withDateStamp } from "@/lib/download";

function fmtDT(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

const STATUS_CONFIG = {
  paid:    { label:"Payé ✅",    cls:"bg-green-100 text-green-700 border-green-300",  icon:"✅" },
  partial: { label:"Acompte 🟡", cls:"bg-yellow-100 text-yellow-700 border-yellow-300", icon:"🟡" },
  unpaid:  { label:"Impayé 🔴",  cls:"bg-red-100 text-red-700 border-red-300",       icon:"🔴" },
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "💵 Espèces",
  mtn_momo: "📱 MTN MoMo",
  orange_money: "🟠 Orange Money",
  other: "Autre",
};

const SERVICES = [
  "Consultation générale","Consultation dentaire","Extraction simple",
  "Extraction chirurgicale","Détartrage","Obturation composite",
  "Obturation amalgame","Pulpectomie","Traitement canalaire",
  "Pose de couronne","Radiographie","Prescription médicale",
  "Certificat médical","Hospitalisation","Chirurgie","Autre",
];

export function PaymentsPage() {
  const clinicId = localStorage.getItem("divinelink.clinicId") || "";
  const { user } = useAuth();
  const actor = user?.name || "unknown";
  const [payments, setPayments] = useState<Payment[]>([]);
  const [patients, setPatients] = useState<{ id:number; name:string; anonCode:string }[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("overview");
  const [addOpen, setAddOpen] = useState(false);
  const [detailPayment, setDetailPayment] = useState<Payment|null>(null);
  const [installmentOpen, setInstallmentOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment|null>(null);

  // Add payment form
  const [form, setForm] = useState({
    patientId:"", label:"Consultation générale", amountDue:0,
    amountPaid:0, method:"cash" as PaymentMethod,
    dueDate:"", notes:""
  });

  // Add installment form
  const [instForm, setInstForm] = useState({ amount:0, method:"cash" as PaymentMethod, notes:"" });

  const load = async () => {
    const allPays = await db.payments.toArray();
    setPayments(allPays.sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
    const pats = await decryptPatients(await db.patients.toArray());
    setPatients(pats.map(p => ({ id:p.id!, name:`${p.firstName} ${p.lastName}`, anonCode:p.anonCode||"" })));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = [...payments];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(p => {
        const pat = patients.find(x => x.id === p.patientId);
        return (pat?.name||"").toLowerCase().includes(s) ||
          (pat?.anonCode||"").toLowerCase().includes(s) ||
          p.label.toLowerCase().includes(s);
      });
    }
    if (statusFilter !== "all") list = list.filter(p => p.status === statusFilter);
    return list;
  }, [payments, search, statusFilter, patients]);

  // Stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const monthStart = new Date(); monthStart.setDate(1);
    const ms = monthStart.toISOString().split("T")[0];
    const totalDue = payments.reduce((s,p) => s + p.amountDue, 0);
    const totalPaid = payments.reduce((s,p) => s + p.amountPaid, 0);
    const totalBalance = payments.reduce((s,p) => s + (p.amountDue - p.amountPaid), 0);
    const todayRevenue = payments.filter(p => (p.paidAt||p.createdAt).startsWith(today)).reduce((s,p) => s + p.amountPaid, 0);
    const monthRevenue = payments.filter(p => (p.paidAt||p.createdAt) >= ms).reduce((s,p) => s + p.amountPaid, 0);
    const paidCount = payments.filter(p => p.status==="paid").length;
    const partialCount = payments.filter(p => p.status==="partial").length;
    const unpaidCount = payments.filter(p => p.status==="unpaid").length;
    return { totalDue, totalPaid, totalBalance, todayRevenue, monthRevenue, paidCount, partialCount, unpaidCount };
  }, [payments]);

  // Patient summary (all payments grouped by patient)
  const patientSummaries = useMemo(() => {
    const map: Record<number, { patient: typeof patients[0]; totalDue:number; totalPaid:number; balance:number; payments:Payment[] }> = {};
    payments.forEach(p => {
      if (!map[p.patientId]) {
        const pat = patients.find(x => x.id === p.patientId);
        if (!pat) return;
        map[p.patientId] = { patient: pat, totalDue:0, totalPaid:0, balance:0, payments:[] };
      }
      map[p.patientId].totalDue += p.amountDue;
      map[p.patientId].totalPaid += p.amountPaid;
      map[p.patientId].balance += (p.amountDue - p.amountPaid);
      map[p.patientId].payments.push(p);
    });
    return Object.values(map).sort((a,b) => b.balance - a.balance);
  }, [payments, patients]);

  const addPayment = async () => {
    if (!form.patientId || !form.amountDue) { toast.error("Patient et montant requis"); return; }
    const now = new Date().toISOString();
    const due = form.amountDue;
    const paid = form.amountPaid;
    const status: PaymentStatus = paid >= due ? "paid" : paid > 0 ? "partial" : "unpaid";
    const installments: PaymentInstallment[] = paid > 0 ? [{
      id: Date.now().toString(), amount: paid,
      method: form.method, paidAt: now, notes: form.notes||undefined
    }] : [];
    const id = await db.payments.add({
      patientId: Number(form.patientId),
      label: form.label,
      amountDue: due, amountPaid: paid,
      balance: due - paid,
      status, method: form.method,
      paidAt: paid > 0 ? now : undefined,
      dueDate: form.dueDate || undefined,
      installments, notes: form.notes || undefined,
      clinicId, createdAt: now, updatedAt: now
    } as Payment);
    const pat = patients.find(p => p.id === Number(form.patientId));
    await logAudit("payment_create", actor, {
      resource: "payment", resourceId: id,
      message: `${pat?.name || "?"} · ${form.label} · due=${due} paid=${paid} (${status}) ${form.method}`
    });
    toast.success("Paiement enregistré ✅");
    setAddOpen(false);
    setForm({ patientId:"", label:"Consultation générale", amountDue:0, amountPaid:0, method:"cash", dueDate:"", notes:"" });
    load();
  };

  const addInstallment = async () => {
    if (!selectedPayment?.id || !instForm.amount) return;
    const now = new Date().toISOString();
    const newPaid = (selectedPayment.amountPaid||0) + instForm.amount;
    const newBalance = selectedPayment.amountDue - newPaid;
    const newStatus: PaymentStatus = newPaid >= selectedPayment.amountDue ? "paid" : "partial";
    const installments = [...(selectedPayment.installments||[]), {
      id: Date.now().toString(), amount: instForm.amount,
      method: instForm.method, paidAt: now, notes: instForm.notes||undefined
    }];
    await db.payments.update(selectedPayment.id, {
      amountPaid: newPaid, balance: Math.max(0, newBalance),
      status: newStatus, paidAt: now,
      installments, updatedAt: now
    });
    await logAudit("payment_installment", actor, {
      resource: "payment", resourceId: selectedPayment.id,
      message: `+${instForm.amount} ${instForm.method} → ${newStatus} (paid ${newPaid}/${selectedPayment.amountDue})`
    });
    toast.success(`✅ +${instForm.amount.toLocaleString()} FCFA enregistré`);
    if (newStatus === "paid") toast.success("🎉 Solde soldé complètement!");
    setInstallmentOpen(false);
    setInstForm({ amount:0, method:"cash", notes:"" });
    load();
  };

  const exportPayments = () => {
    const rows = filtered.map(p => {
      const pat = patients.find(x => x.id === p.patientId);
      return {
        Date: fmtDT(p.createdAt), Patient: pat?.name||"—",
        "Code anonyme": pat?.anonCode||"—", Service: p.label,
        "Montant dû (FCFA)": p.amountDue, "Montant payé (FCFA)": p.amountPaid,
        "Solde restant (FCFA)": p.amountDue - p.amountPaid,
        Statut: STATUS_CONFIG[p.status].label,
        "Mode paiement": METHOD_LABELS[p.method],
        "Date paiement": p.paidAt ? fmtDT(p.paidAt) : "—",
        "Date limite": p.dueDate ? fmtDate(p.dueDate) : "—",
        Notes: p.notes||""
      };
    });
    saveFile(withDateStamp("paiements") + ".csv", toCsv(rows), "csv");
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-primary"/>
          <h1 className="text-2xl font-bold">Paiements</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportPayments}>
            <Download className="w-4 h-4 mr-1"/>Export
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-1"/>Nouveau paiement
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-3 pb-3 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.totalPaid.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA encaissés total</div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
          <CardContent className="pt-3 pb-3 text-center">
            <div className="text-2xl font-bold text-red-600">{stats.totalBalance.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA restant à encaisser</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <div className="text-2xl font-bold text-primary">{stats.todayRevenue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA aujourd'hui</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <div className="text-2xl font-bold">{stats.monthRevenue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA ce mois</div>
          </CardContent>
        </Card>
      </div>

      {/* Status overview pills */}
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 gap-1">
          <CheckCircle className="w-3 h-3"/> {stats.paidCount} Payés
        </Badge>
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300 gap-1">
          <Clock className="w-3 h-3"/> {stats.partialCount} Acomptes
        </Badge>
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 gap-1">
          <AlertCircle className="w-3 h-3"/> {stats.unpaidCount} Impayés
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="overview">Par patient</TabsTrigger>
          <TabsTrigger value="transactions">Toutes transactions</TabsTrigger>
        </TabsList>

        {/* BY PATIENT */}
        <TabsContent value="overview" className="space-y-3 mt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
            <Input className="pl-9" placeholder="Rechercher patient..." value={search} onChange={e => setSearch(e.target.value)}/>
          </div>

          {patientSummaries.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-20"/>
              <p>Aucun paiement enregistré</p>
            </div>
          )}

          <div className="space-y-3">
            {patientSummaries
              .filter(s => !search || s.patient.name.toLowerCase().includes(search.toLowerCase()) || s.patient.anonCode.toLowerCase().includes(search.toLowerCase()))
              .map(({ patient, totalDue, totalPaid, balance, payments: plist }) => {
                const hasDebt = balance > 0;
                const fullyPaid = balance <= 0 && totalDue > 0;
                return (
                  <Card key={patient.id} className={`border-l-4 ${hasDebt ? "border-l-red-400" : "border-l-green-400"}`}>
                    <CardContent className="pt-3 pb-3">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-bold text-base">{patient.name}</div>
                          <div className="text-xs text-muted-foreground">{patient.anonCode}</div>
                        </div>
                        <Badge variant="outline" className={hasDebt ? "bg-red-50 text-red-700 border-red-300" : "bg-green-50 text-green-700 border-green-300"}>
                          {hasDebt ? `🔴 Doit ${balance.toLocaleString()} FCFA` : "✅ Soldé"}
                        </Badge>
                      </div>

                      {/* Payment progress */}
                      <div className="space-y-1 mb-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Total facturé:</span>
                          <span className="font-semibold">{totalDue.toLocaleString()} FCFA</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Payé:</span>
                          <span className="font-semibold text-green-600">+{totalPaid.toLocaleString()} FCFA</span>
                        </div>
                        {balance > 0 && (
                          <div className="flex justify-between text-sm border-t pt-1">
                            <span className="font-bold">Reste à payer:</span>
                            <span className="font-bold text-red-600">{balance.toLocaleString()} FCFA</span>
                          </div>
                        )}
                        {/* Progress bar */}
                        {totalDue > 0 && (
                          <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                            <div
                              className="bg-green-500 h-2 rounded-full transition-all"
                              style={{ width: `${Math.min(100, (totalPaid/totalDue)*100)}%` }}
                            />
                          </div>
                        )}
                        {totalDue > 0 && (
                          <div className="text-xs text-muted-foreground text-right">
                            {Math.round((totalPaid/totalDue)*100)}% payé
                          </div>
                        )}
                      </div>

                      {/* Individual payment lines */}
                      <div className="space-y-1 mb-2">
                        {plist.slice(0,5).map(p => (
                          <div key={p.id} className="flex justify-between items-center text-xs py-1 border-b last:border-0">
                            <div>
                              <span className="font-medium">{p.label}</span>
                              <span className="text-muted-foreground ml-2">{fmtDate(p.createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span>{p.amountPaid.toLocaleString()}/{p.amountDue.toLocaleString()} FCFA</span>
                              <Badge variant="outline" className={`text-[10px] ${STATUS_CONFIG[p.status].cls}`}>
                                {STATUS_CONFIG[p.status].icon}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Actions */}
                      {hasDebt && (
                        <Button size="sm" className="w-full bg-green-600 hover:bg-green-700 text-white" onClick={() => {
                          // Find first unpaid/partial payment for this patient
                          const unpaidPay = plist.find(p => p.status !== "paid");
                          if (unpaidPay) { setSelectedPayment(unpaidPay); setInstallmentOpen(true); }
                        }}>
                          <PlusCircle className="w-3 h-3 mr-1"/> Enregistrer un versement
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </TabsContent>

        {/* ALL TRANSACTIONS */}
        <TabsContent value="transactions" className="space-y-3 mt-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
              <Input className="pl-9 h-8 text-sm" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)}/>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-auto min-w-[110px] h-8 text-xs"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="paid">Payés ✅</SelectItem>
                <SelectItem value="partial">Acomptes 🟡</SelectItem>
                <SelectItem value="unpaid">Impayés 🔴</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            {filtered.map(p => {
              const pat = patients.find(x => x.id === p.patientId);
              const balance = p.amountDue - p.amountPaid;
              return (
                <Card key={p.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-bold text-sm">{pat?.name||"Patient inconnu"}</span>
                          <Badge variant="outline" className={`text-xs ${STATUS_CONFIG[p.status].cls}`}>
                            {STATUS_CONFIG[p.status].label}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mb-1">{p.label}</div>
                        <div className="flex gap-3 text-sm flex-wrap">
                          <span>Facturé: <span className="font-semibold">{p.amountDue.toLocaleString()} FCFA</span></span>
                          <span className="text-green-600">Payé: <span className="font-semibold">{p.amountPaid.toLocaleString()}</span></span>
                          {balance > 0 && <span className="text-red-600 font-bold">Reste: {balance.toLocaleString()} FCFA</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {METHOD_LABELS[p.method]} · {fmtDT(p.createdAt)}
                          {p.dueDate && ` · Échéance: ${fmtDate(p.dueDate)}`}
                        </div>
                        {/* Installments history */}
                        {p.installments && p.installments.length > 1 && (
                          <div className="mt-2 space-y-1">
                            <div className="text-xs font-medium text-muted-foreground">Versements ({p.installments.length}):</div>
                            {p.installments.map(inst => (
                              <div key={inst.id} className="text-xs flex justify-between text-muted-foreground">
                                <span>{fmtDT(inst.paidAt)}</span>
                                <span className="font-medium text-foreground">+{inst.amount.toLocaleString()} FCFA — {METHOD_LABELS[inst.method]}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {p.status !== "paid" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => {
                            setSelectedPayment(p); setInstallmentOpen(true);
                          }}>
                            <PlusCircle className="w-4 h-4"/>
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={async () => {
                          if (p.id) {
                            await db.payments.delete(p.id);
                            await logAudit("payment_delete", actor, { resource: "payment", resourceId: p.id, message: `${p.label} · ${p.amountDue} FCFA` });
                            toast.success("Supprimé"); load();
                          }
                        }}>
                          <Trash2 className="w-3 h-3"/>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* ADD PAYMENT DIALOG */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouveau paiement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Patient *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f=>({...f,patientId:v}))}>
                <SelectTrigger><SelectValue placeholder="Choisir patient..."/></SelectTrigger>
                <SelectContent>
                  {patients.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Service / Acte *</Label>
              <Select value={form.label} onValueChange={v => setForm(f=>({...f,label:v}))}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {SERVICES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Montant total dû (FCFA) *</Label>
                <Input type="number" min={0} value={form.amountDue||""} onChange={e => setForm(f=>({...f,amountDue:+e.target.value}))} placeholder="ex: 15000"/>
              </div>
              <div><Label>Acompte versé maintenant</Label>
                <Input type="number" min={0} max={form.amountDue} value={form.amountPaid||""} onChange={e => setForm(f=>({...f,amountPaid:+e.target.value}))} placeholder="0 si rien"/>
              </div>
            </div>
            {form.amountDue > 0 && (
              <div className={`rounded-lg p-3 text-sm font-medium ${form.amountPaid >= form.amountDue ? "bg-green-50 text-green-700" : form.amountPaid > 0 ? "bg-yellow-50 text-yellow-700" : "bg-red-50 text-red-700"}`}>
                {form.amountPaid >= form.amountDue
                  ? "✅ Paiement complet"
                  : form.amountPaid > 0
                  ? `🟡 Acompte — Reste: ${(form.amountDue - form.amountPaid).toLocaleString()} FCFA`
                  : `🔴 Impayé — Total dû: ${form.amountDue.toLocaleString()} FCFA`}
              </div>
            )}
            <div><Label>Mode de paiement</Label>
              <Select value={form.method} onValueChange={v => setForm(f=>({...f,method:v as PaymentMethod}))}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {Object.entries(METHOD_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Date limite de paiement (optionnel)</Label>
              <Input type="date" value={form.dueDate} onChange={e => setForm(f=>({...f,dueDate:e.target.value}))}/>
            </div>
            <div><Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} rows={2} placeholder="Remarques..."/>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Annuler</Button>
            <Button onClick={addPayment}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD INSTALLMENT DIALOG */}
      <Dialog open={installmentOpen} onOpenChange={setInstallmentOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>💰 Enregistrer un versement</DialogTitle>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-3">
              <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
                <div className="font-bold">{selectedPayment.label}</div>
                <div className="flex justify-between">
                  <span>Total dû:</span>
                  <span className="font-semibold">{selectedPayment.amountDue.toLocaleString()} FCFA</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>Déjà payé:</span>
                  <span className="font-semibold">{selectedPayment.amountPaid.toLocaleString()} FCFA</span>
                </div>
                <div className="flex justify-between text-red-600 font-bold border-t pt-1">
                  <span>Reste à payer:</span>
                  <span>{(selectedPayment.amountDue - selectedPayment.amountPaid).toLocaleString()} FCFA</span>
                </div>
              </div>
              <div><Label>Montant versé maintenant (FCFA) *</Label>
                <Input type="number" min={1} max={selectedPayment.amountDue - selectedPayment.amountPaid}
                  value={instForm.amount||""} onChange={e => setInstForm(f=>({...f,amount:+e.target.value}))}
                  placeholder={`Max: ${(selectedPayment.amountDue - selectedPayment.amountPaid).toLocaleString()} FCFA`}/>
              </div>
              {instForm.amount > 0 && (
                <div className={`rounded p-2 text-sm font-medium ${instForm.amount >= (selectedPayment.amountDue - selectedPayment.amountPaid) ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
                  {instForm.amount >= (selectedPayment.amountDue - selectedPayment.amountPaid)
                    ? "✅ Ce versement solde le compte complètement!"
                    : `🟡 Reste après ce versement: ${(selectedPayment.amountDue - selectedPayment.amountPaid - instForm.amount).toLocaleString()} FCFA`}
                </div>
              )}
              <div><Label>Mode de paiement</Label>
                <Select value={instForm.method} onValueChange={v => setInstForm(f=>({...f,method:v as PaymentMethod}))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notes</Label>
                <Input value={instForm.notes} onChange={e => setInstForm(f=>({...f,notes:e.target.value}))} placeholder="Remarques..."/>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallmentOpen(false)}>Annuler</Button>
            <Button onClick={addInstallment} className="bg-green-600 hover:bg-green-700">Confirmer versement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
