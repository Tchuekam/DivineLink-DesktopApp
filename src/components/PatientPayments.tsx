import React, { useEffect, useState, useMemo } from "react";
import { db, type Payment, type PaymentInstallment, type PaymentMethod } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, CreditCard, CheckCircle, Clock, AlertCircle, TrendingUp, Trash2 } from "lucide-react";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "💵 Espèces" },
  { value: "mtn_momo", label: "📱 MTN Mobile Money" },
  { value: "orange_money", label: "🟠 Orange Money" },
  { value: "other", label: "Autre" },
];

function fmtDT(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function StatusBadge({ payment }: { payment: Payment }) {
  if (payment.balance <= 0)
    return <Badge className="bg-green-100 text-green-700 border-green-300">✅ Payé</Badge>;
  if (payment.amountPaid > 0)
    return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300">⏳ Partiel</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-300">❌ Impayé</Badge>;
}

interface Props {
  patientId: number;
  patientName?: string;
  showSummaryOnly?: boolean;
  onUpdate?: () => void;
}

export function PatientPayments({ patientId, patientName, showSummaryOnly = false, onUpdate }: Props) {
  const { user } = useAuth();
  const clinicId = localStorage.getItem("divinelink.clinicId") || "";
  const [payments, setPayments] = useState<Payment[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [installmentOpen, setInstallmentOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [deletePayment, setDeletePayment] = useState<Payment | null>(null);

  const [form, setForm] = useState({
    label: "", amountDue: 0, amountPaid: 0,
    method: "cash" as PaymentMethod, dueDate: "", notes: ""
  });
  const [instForm, setInstForm] = useState({
    amount: 0, method: "cash" as PaymentMethod, notes: ""
  });

  const load = async () => {
    const all = await db.payments.where("patientId").equals(patientId).toArray();
    setPayments(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  };

  useEffect(() => { load(); }, [patientId]);

  // Summary calculations
  const summary = useMemo(() => {
    const totalDue = payments.reduce((s, p) => s + p.amountDue, 0);
    const totalPaid = payments.reduce((s, p) => s + p.amountPaid, 0);
    const totalBalance = payments.reduce((s, p) => s + p.balance, 0);
    const paid = payments.filter(p => p.balance <= 0).length;
    const partial = payments.filter(p => p.amountPaid > 0 && p.balance > 0).length;
    const unpaid = payments.filter(p => p.amountPaid === 0).length;
    return { totalDue, totalPaid, totalBalance, paid, partial, unpaid };
  }, [payments]);

  const savePayment = async () => {
    if (!form.label || form.amountDue <= 0) {
      toast.error("Libellé et montant requis");
      return;
    }
    const now = new Date().toISOString();
    const balance = Math.max(0, form.amountDue - form.amountPaid);
    const status: any = balance <= 0 ? "paid" : form.amountPaid > 0 ? "partial" : "unpaid";
    const installments: PaymentInstallment[] = form.amountPaid > 0 ? [{
      id: crypto.randomUUID(),
      amount: form.amountPaid,
      method: form.method,
      paidAt: now,
      receivedBy: user?.name || "Admin",
      notes: form.notes
    }] : [];

    const newId = await db.payments.add({
      patientId, label: form.label,
      amountDue: form.amountDue,
      amountPaid: form.amountPaid,
      balance, status, method: form.method,
      paidAt: form.amountPaid > 0 ? now : undefined,
      dueDate: form.dueDate || undefined,
      installments, notes: form.notes,
      clinicId, createdAt: now, updatedAt: now
    } as Payment);
    await logAudit("payment_create", user?.name || "unknown", {
      resource: "payment", resourceId: newId,
      message: `patient#${patientId} · ${form.label} · due=${form.amountDue} paid=${form.amountPaid} (${status})`
    });

    toast.success("Paiement enregistré ✅");
    setAddOpen(false);
    if (onUpdate) onUpdate();
    setForm({ label:"", amountDue:0, amountPaid:0, method:"cash", dueDate:"", notes:"" });
    load();
  };

  const addInstallment = async () => {
    if (!selectedPayment || instForm.amount <= 0) return;
    const now = new Date().toISOString();
    const newInstallment: PaymentInstallment = {
      id: crypto.randomUUID(),
      amount: instForm.amount,
      method: instForm.method,
      paidAt: now,
      receivedBy: user?.name || "Admin",
      notes: instForm.notes
    };
    const newAmountPaid = selectedPayment.amountPaid + instForm.amount;
    const newBalance = Math.max(0, selectedPayment.amountDue - newAmountPaid);
    const newStatus: any = newBalance <= 0 ? "paid" : "partial";
    const updatedInstallments = [...(selectedPayment.installments || []), newInstallment];

    await db.payments.update(selectedPayment.id!, {
      amountPaid: newAmountPaid,
      balance: newBalance,
      status: newStatus,
      paidAt: newBalance <= 0 ? now : selectedPayment.paidAt,
      installments: updatedInstallments,
      updatedAt: now
    });
    await logAudit("payment_installment", user?.name || "unknown", {
      resource: "payment", resourceId: selectedPayment.id,
      message: `+${instForm.amount} ${instForm.method} → ${newStatus}`
    });

    toast.success(`✅ ${instForm.amount.toLocaleString()} FCFA enregistrés`);
    if (newBalance <= 0) toast.success("🎉 Solde soldé!");
    setInstallmentOpen(false);
    setInstForm({ amount: 0, method: "cash", notes: "" });
    load();
  };

  if (showSummaryOnly) {
    return (
      <div className="space-y-2">
        {summary.totalBalance > 0 && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 rounded-lg p-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-red-700">💰 Solde restant</span>
              <span className="text-xl font-bold text-red-700">{summary.totalBalance.toLocaleString()} FCFA</span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted rounded p-2">
            <div className="text-lg font-bold">{summary.totalDue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total dû (FCFA)</div>
          </div>
          <div className="bg-green-50 dark:bg-green-950/30 rounded p-2">
            <div className="text-lg font-bold text-green-600">{summary.totalPaid.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total payé (FCFA)</div>
          </div>
          <div className="bg-red-50 dark:bg-red-950/30 rounded p-2">
            <div className="text-lg font-bold text-red-600">{summary.totalBalance.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Reste à payer</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-3 pb-3">
            <div className="text-2xl font-bold">{summary.totalDue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA total facturé</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-3 pb-3">
            <div className="text-2xl font-bold text-green-600">{summary.totalPaid.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA encaissés</div>
          </CardContent>
        </Card>
      </div>

      {summary.totalBalance > 0 && (
        <Card className="border-2 border-red-300 bg-red-50 dark:bg-red-950/30">
          <CardContent className="pt-3 pb-3 flex justify-between items-center">
            <div>
              <div className="text-xs text-red-600 font-medium">💰 SOLDE RESTANT À PAYER</div>
              <div className="text-3xl font-bold text-red-700">{summary.totalBalance.toLocaleString()} FCFA</div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>✅ Réglés: {summary.paid}</div>
              <div>⏳ Partiels: {summary.partial}</div>
              <div>❌ Impayés: {summary.unpaid}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {summary.totalBalance === 0 && payments.length > 0 && (
        <Card className="border-2 border-green-300 bg-green-50 dark:bg-green-950/30">
          <CardContent className="pt-3 pb-3 text-center">
            <div className="text-green-600 font-bold text-lg">✅ Compte soldé — Aucun impayé</div>
          </CardContent>
        </Card>
      )}

      {/* Add payment button */}
      <Button onClick={() => setAddOpen(true)} className="w-full">
        <Plus className="w-4 h-4 mr-2"/>Ajouter une prestation / paiement
      </Button>

      {/* Payment list */}
      {payments.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-20"/>
          <p>Aucun paiement enregistré</p>
        </div>
      )}

      <div className="space-y-3">
        {payments.map(payment => (
          <Card key={payment.id} className={`border-l-4 ${payment.balance <= 0 ? 'border-l-green-500' : payment.amountPaid > 0 ? 'border-l-yellow-500' : 'border-l-red-500'}`}>
            <CardContent className="pt-3 pb-3">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base">{payment.label}</span>
                    <StatusBadge payment={payment}/>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{fmtDT(payment.createdAt)}</div>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive shrink-0"
                  onClick={() => setDeletePayment(payment)}>
                  <Trash2 className="w-3 h-3"/>
                </Button>
              </div>

              {/* Amount breakdown */}
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div className="bg-muted rounded p-2">
                  <div className="text-sm font-bold">{payment.amountDue.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Montant dû</div>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 rounded p-2">
                  <div className="text-sm font-bold text-green-600">{payment.amountPaid.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Payé</div>
                </div>
                <div className={`rounded p-2 ${payment.balance > 0 ? 'bg-red-50 dark:bg-red-950/30' : 'bg-green-50 dark:bg-green-950/30'}`}>
                  <div className={`text-sm font-bold ${payment.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {payment.balance.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">Restant</div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div
                  className={`h-2 rounded-full transition-all ${payment.balance <= 0 ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{ width: `${Math.min(100, (payment.amountPaid / payment.amountDue) * 100)}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground text-right">
                {Math.round((payment.amountPaid / payment.amountDue) * 100)}% payé
              </div>

              {/* Installments history */}
              {payment.installments && payment.installments.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs font-semibold text-muted-foreground">Historique des versements:</div>
                  {payment.installments.map(inst => (
                    <div key={inst.id} className="flex justify-between text-xs bg-muted rounded p-1.5">
                      <span>{fmtDT(inst.paidAt)} — {METHODS.find(m => m.value === inst.method)?.label}</span>
                      <span className="font-bold text-green-600">+{inst.amount.toLocaleString()} FCFA</span>
                    </div>
                  ))}
                </div>
              )}

              {payment.dueDate && payment.balance > 0 && (
                <div className="mt-2 text-xs text-orange-600">
                  ⏰ Échéance: {fmtDT(payment.dueDate)}
                </div>
              )}

              {/* Add installment button if not fully paid */}
              {payment.balance > 0 && (
                <Button size="sm" variant="outline" className="w-full mt-2 text-xs" onClick={() => {
                  setSelectedPayment(payment);
                  setInstForm({ amount: payment.balance, method: "cash", notes: "" });
                  setInstallmentOpen(true);
                }}>
                  💳 Enregistrer un versement ({payment.balance.toLocaleString()} FCFA restants)
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ADD PAYMENT DIALOG */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouvelle prestation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Libellé *</Label>
              <Input value={form.label} onChange={e => setForm(f=>({...f,label:e.target.value}))}
                placeholder="ex: Consultation, Extraction, Détartrage..."/>
            </div>
            <div>
              <Label>Montant total dû (FCFA) *</Label>
              <Input type="number" min={0} value={form.amountDue||""}
                onChange={e => setForm(f=>({...f,amountDue:+e.target.value}))}
                className="text-lg font-bold" placeholder="ex: 15000"/>
            </div>
            <div>
              <Label>Acompte versé maintenant (FCFA)</Label>
              <Input type="number" min={0} max={form.amountDue} value={form.amountPaid||""}
                onChange={e => setForm(f=>({...f,amountPaid:Math.min(+e.target.value, form.amountDue)}))}
                placeholder="0 si rien payé maintenant"/>
            </div>
            {form.amountDue > 0 && (
              <div className={`rounded p-2 text-center ${form.amountPaid >= form.amountDue ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="text-xs text-muted-foreground">Restant après cet acompte</div>
                <div className={`text-xl font-bold ${form.amountPaid >= form.amountDue ? 'text-green-600' : 'text-red-600'}`}>
                  {Math.max(0, form.amountDue - form.amountPaid).toLocaleString()} FCFA
                </div>
              </div>
            )}
            <div>
              <Label>Mode de paiement</Label>
              <Select value={form.method} onValueChange={v => setForm(f=>({...f,method:v as PaymentMethod}))}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date limite de paiement (optionnel)</Label>
              <Input type="date" value={form.dueDate} onChange={e => setForm(f=>({...f,dueDate:e.target.value}))}/>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} rows={2}/>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Annuler</Button>
            <Button onClick={savePayment}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD INSTALLMENT DIALOG */}
      <Dialog open={installmentOpen} onOpenChange={setInstallmentOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>💳 Enregistrer un versement</DialogTitle>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-3">
              <div className="bg-muted rounded p-3 text-center">
                <div className="text-xs text-muted-foreground">Restant à payer pour</div>
                <div className="font-bold">{selectedPayment.label}</div>
                <div className="text-2xl font-bold text-red-600">{selectedPayment.balance.toLocaleString()} FCFA</div>
              </div>
              <div>
                <Label>Montant versé maintenant (FCFA) *</Label>
                <Input type="number" min={1} max={selectedPayment.balance}
                  value={instForm.amount||""}
                  onChange={e => setInstForm(f=>({...f,amount:Math.min(+e.target.value, selectedPayment.balance)}))}
                  className="text-lg font-bold"/>
              </div>
              {instForm.amount > 0 && (
                <div className={`rounded p-2 text-center ${instForm.amount >= selectedPayment.balance ? 'bg-green-50' : 'bg-yellow-50'}`}>
                  <div className="text-xs">Après ce versement il restera:</div>
                  <div className={`text-xl font-bold ${instForm.amount >= selectedPayment.balance ? 'text-green-600' : 'text-orange-600'}`}>
                    {Math.max(0, selectedPayment.balance - instForm.amount).toLocaleString()} FCFA
                  </div>
                  {instForm.amount >= selectedPayment.balance && <div className="text-green-600 text-xs font-bold">🎉 Solde soldé!</div>}
                </div>
              )}
              <div>
                <Label>Mode de paiement</Label>
                <Select value={instForm.method} onValueChange={v => setInstForm(f=>({...f,method:v as PaymentMethod}))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={instForm.notes} onChange={e => setInstForm(f=>({...f,notes:e.target.value}))}/>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallmentOpen(false)}>Annuler</Button>
            <Button onClick={addInstallment} className="bg-green-600 hover:bg-green-700">
              Confirmer versement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE */}
      <Dialog open={!!deletePayment} onOpenChange={() => setDeletePayment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Supprimer cette prestation?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">"{deletePayment?.label}" — {deletePayment?.amountDue.toLocaleString()} FCFA</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePayment(null)}>Annuler</Button>
            <Button variant="destructive" onClick={async () => {
              if (deletePayment?.id) {
                await db.payments.delete(deletePayment.id);
                await logAudit("payment_delete", user?.name || "unknown", { resource: "payment", resourceId: deletePayment.id, message: `${deletePayment.label} · ${deletePayment.amountDue} FCFA` });
                toast.success("Prestation supprimée");
                setDeletePayment(null);
                load();
              }
            }}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
