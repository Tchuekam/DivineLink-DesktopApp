import React, { useEffect, useState, useMemo } from "react";
import { db, type Payment } from "@/lib/db";
import { decryptPatients } from "@/lib/patientCrypto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, TrendingUp, Users, AlertCircle, CheckCircle } from "lucide-react";
import { saveFile, toCsv, withDateStamp } from "@/lib/download";
import { PatientPayments } from "./PatientPayments";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

export function GlobalPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [patients, setPatients] = useState<{id:number;name:string;anonCode:string}[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPatientId, setSelectedPatientId] = useState<number|null>(null);

  const load = async () => {
    const allPayments = await db.payments.toArray();
    setPayments(allPayments);
    const allPatients = await decryptPatients(await db.patients.toArray());
    setPatients(allPatients.map(p => ({ id:p.id!, name:`${p.firstName} ${p.lastName}`, anonCode:p.anonCode||"" })));
  };

  useEffect(() => { load(); }, []);

  // Group payments by patient
  const patientSummaries = useMemo(() => {
    const map: Record<number, {
      patientId: number; name: string; anonCode: string;
      totalDue: number; totalPaid: number; balance: number;
      lastPayment?: string; paymentCount: number;
    }> = {};

    payments.forEach(p => {
      if (!map[p.patientId]) {
        const pat = patients.find(x => x.id === p.patientId);
        map[p.patientId] = {
          patientId: p.patientId,
          name: pat?.name || "Patient inconnu",
          anonCode: pat?.anonCode || "",
          totalDue: 0, totalPaid: 0, balance: 0,
          paymentCount: 0
        };
      }
      map[p.patientId].totalDue += p.amountDue;
      map[p.patientId].totalPaid += p.amountPaid;
      map[p.patientId].balance += p.balance;
      map[p.patientId].paymentCount++;
      if (!map[p.patientId].lastPayment || p.updatedAt > map[p.patientId].lastPayment!) {
        map[p.patientId].lastPayment = p.updatedAt;
      }
    });

    return Object.values(map).sort((a, b) => b.balance - a.balance);
  }, [payments, patients]);

  const filtered = useMemo(() => {
    let list = patientSummaries;
    if (search) list = list.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.anonCode.toLowerCase().includes(search.toLowerCase())
    );
    if (statusFilter === "unpaid") list = list.filter(p => p.balance > 0 && p.totalPaid === 0);
    if (statusFilter === "partial") list = list.filter(p => p.balance > 0 && p.totalPaid > 0);
    if (statusFilter === "paid") list = list.filter(p => p.balance <= 0);
    return list;
  }, [patientSummaries, search, statusFilter]);

  // Global stats
  const globalStats = useMemo(() => ({
    totalDue: patientSummaries.reduce((s,p) => s+p.totalDue, 0),
    totalPaid: patientSummaries.reduce((s,p) => s+p.totalPaid, 0),
    totalBalance: patientSummaries.reduce((s,p) => s+p.balance, 0),
    paidCount: patientSummaries.filter(p => p.balance <= 0).length,
    partialCount: patientSummaries.filter(p => p.balance > 0 && p.totalPaid > 0).length,
    unpaidCount: patientSummaries.filter(p => p.totalPaid === 0 && p.totalDue > 0).length,
  }), [patientSummaries]);

  // Monthly revenue
  const thisMonth = new Date(); thisMonth.setDate(1);
  const monthRevenue = payments
    .filter(p => p.paidAt && new Date(p.paidAt) >= thisMonth)
    .reduce((s,p) => s + p.amountPaid, 0);

  const exportPayments = () => {
    const rows = filtered.map(p => ({
      Patient: p.name, "Code anonyme": p.anonCode,
      "Total facturé (FCFA)": p.totalDue,
      "Total payé (FCFA)": p.totalPaid,
      "Solde restant (FCFA)": p.balance,
      Statut: p.balance <= 0 ? "Soldé" : p.totalPaid > 0 ? "Partiel" : "Impayé",
      "Nbre prestations": p.paymentCount,
      "Dernier mouvement": fmtDate(p.lastPayment||"")
    }));
    saveFile(withDateStamp("paiements-patients")+".csv", toCsv(rows), "csv");
  };

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary"/>Paiements patients
        </h1>
        <Button variant="outline" size="sm" onClick={exportPayments}>
          <Download className="w-4 h-4 mr-1"/>Export CSV
        </Button>
      </div>

      {/* Global summary */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-3 pb-3">
            <div className="text-2xl font-bold">{globalStats.totalDue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA total facturé</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-3 pb-3">
            <div className="text-2xl font-bold text-green-600">{globalStats.totalPaid.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA encaissés</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="pt-3 pb-3">
            <div className="text-2xl font-bold text-red-600">{globalStats.totalBalance.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA restants à percevoir</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="pt-3 pb-3">
            <div className="text-2xl font-bold text-purple-600">{monthRevenue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">FCFA encaissés ce mois</div>
          </CardContent>
        </Card>
      </div>

      {/* Status counts */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-sm">
          <CheckCircle className="w-4 h-4 text-green-600"/>
          <span className="font-bold text-green-600">{globalStats.paidCount}</span>
          <span className="text-muted-foreground">soldés</span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <AlertCircle className="w-4 h-4 text-yellow-600"/>
          <span className="font-bold text-yellow-600">{globalStats.partialCount}</span>
          <span className="text-muted-foreground">partiels</span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <AlertCircle className="w-4 h-4 text-red-600"/>
          <span className="font-bold text-red-600">{globalStats.unpaidCount}</span>
          <span className="text-muted-foreground">impayés</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
          <Input className="pl-9 h-8 text-sm" placeholder="Chercher patient..." value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-auto min-w-[130px] h-8 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous ({patientSummaries.length})</SelectItem>
            <SelectItem value="unpaid">❌ Impayés ({globalStats.unpaidCount})</SelectItem>
            <SelectItem value="partial">⏳ Partiels ({globalStats.partialCount})</SelectItem>
            <SelectItem value="paid">✅ Soldés ({globalStats.paidCount})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Patient payment list */}
      {filtered.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-20"/>
          <p>Aucun paiement enregistré</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(ps => (
          <Card key={ps.patientId}
            className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${
              ps.balance <= 0 ? 'border-l-green-500' :
              ps.totalPaid > 0 ? 'border-l-yellow-500' : 'border-l-red-500'
            }`}
            onClick={() => setSelectedPatientId(ps.patientId)}>
            <CardContent className="pt-3 pb-3">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{ps.name}</span>
                    <Badge variant="outline" className="text-xs font-mono">{ps.anonCode}</Badge>
                    {ps.balance <= 0
                      ? <Badge className="bg-green-100 text-green-700 text-xs">✅ Soldé</Badge>
                      : ps.totalPaid > 0
                        ? <Badge className="bg-yellow-100 text-yellow-700 text-xs">⏳ Partiel</Badge>
                        : <Badge className="bg-red-100 text-red-700 text-xs">❌ Impayé</Badge>
                    }
                  </div>
                  <div className="flex gap-3 mt-1 text-sm flex-wrap">
                    <span className="text-muted-foreground">Facturé: <span className="font-medium text-foreground">{ps.totalDue.toLocaleString()} FCFA</span></span>
                    <span className="text-green-600">Payé: <span className="font-medium">{ps.totalPaid.toLocaleString()} FCFA</span></span>
                    {ps.balance > 0 && <span className="text-red-600 font-bold">Reste: {ps.balance.toLocaleString()} FCFA</span>}
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                    <div className={`h-1.5 rounded-full ${ps.balance <= 0 ? 'bg-green-500' : 'bg-yellow-500'}`}
                      style={{ width: `${Math.min(100, ps.totalDue > 0 ? (ps.totalPaid/ps.totalDue)*100 : 0)}%` }}/>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  {ps.paymentCount} prestation(s)
                  {ps.lastPayment && <div>{fmtDate(ps.lastPayment)}</div>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Patient detail dialog */}
      <Dialog open={!!selectedPatientId} onOpenChange={() => setSelectedPatientId(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Compte patient — {selectedPatient?.name}
              <span className="text-xs font-mono text-muted-foreground ml-2">{selectedPatient?.anonCode}</span>
            </DialogTitle>
          </DialogHeader>
          {selectedPatientId && (
            <PatientPayments
              patientId={selectedPatientId}
              patientName={selectedPatient?.name}
              onUpdate={load}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
