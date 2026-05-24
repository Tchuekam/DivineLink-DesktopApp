import React, { useEffect, useState, useMemo, useCallback } from "react";
import { db, type Drug, type DrugTransaction, type DrugStatus, type TransactionType, type PaymentStatus, type ExitReason, type Patient } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Download, TriangleAlert as AlertTriangle, ArrowDown, ArrowUp, Bell, Pencil, Trash2, ArrowUpDown, Package } from "lucide-react";
import { toast } from "sonner";
import { saveFile, toCsv, withDateStamp } from "@/lib/download";
import { logAudit } from "@/lib/audit";
import { decryptPatients } from "@/lib/patientCrypto";

/* ---- Constants ---- */
const DRUG_CATEGORIES = [
  "Consommable ortho",
  "Contrôle infection",
  "Médicament",
  "Anesthésique",
  "Antiseptique",
  "Radiologie",
  "Instruments",
  "Autre",
];

const STATUS_ICONS: Record<DrugStatus, string> = {
  in_stock: "🟢", low: "🟡", out: "🔴", expiring_soon: "⚠️",
};

type SortKey = "az" | "stock" | "expiry" | "category";

function computeStatus(drug: Drug): DrugStatus {
  if (drug.stock <= 0) return "out";
  if (drug.expiration) {
    const days = (new Date(drug.expiration).getTime() - Date.now()) / 86400_000;
    if (days < 30) return "expiring_soon";
  }
  if (drug.stock <= drug.minStock) return "low";
  return "in_stock";
}

function daysUntilExpiry(expiration?: string): number | null {
  if (!expiration) return null;
  return Math.ceil((new Date(expiration).getTime() - Date.now()) / 86400_000);
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ============================================================ */
export function PharmacyPage() {
  const { t } = useLang();
  const [tab, setTab] = useState("inventory");
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [transactions, setTransactions] = useState<DrugTransaction[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);

  const load = useCallback(async () => {
    const allDrugs = await db.drugs.toArray();
    for (const d of allDrugs) {
      const s = computeStatus(d);
      if (d.status !== s) { d.status = s; await db.drugs.update(d.id!, { status: s }); }
    }
    setDrugs(allDrugs);
    setTransactions(await db.drugTransactions.reverse().sortBy("createdAt"));
    setPatients(await decryptPatients(await db.patients.toArray()));
  }, []);

  useEffect(() => { load(); }, [load]);

  const alerts = useMemo(() => {
    const a: { type: string; message: string; drugId: number; urgency: number }[] = [];
    drugs.forEach(d => {
      if (d.status === "out") a.push({ type: "out", message: `${d.name}: épuisé`, drugId: d.id!, urgency: 1 });
      if (d.status === "low") a.push({ type: "low", message: `${d.name}: ${d.stock} ${d.unit} (min: ${d.minStock})`, drugId: d.id!, urgency: 2 });
      if (d.status === "expiring_soon" && d.expiration) {
        const days = daysUntilExpiry(d.expiration);
        a.push({ type: "expiring", message: `${d.name}: expire dans ${days} j (${new Date(d.expiration).toLocaleDateString()})`, drugId: d.id!, urgency: 3 });
      }
    });
    return a.sort((a, b) => a.urgency - b.urgency);
  }, [drugs]);

  const stats = useMemo(() => {
    const totalValue = drugs.reduce((s, d) => s + d.stock * d.buyPrice, 0);
    const today = new Date().toISOString().split("T")[0];
    const monthStart = new Date(); monthStart.setDate(1);
    const ms = monthStart.toISOString().split("T")[0];
    const revenueToday = transactions.filter(t => t.type === "out" && t.createdAt >= today).reduce((s, t) => s + t.price * t.quantity, 0);
    const revenueMonth = transactions.filter(t => t.type === "out" && t.createdAt >= ms).reduce((s, t) => s + t.price * t.quantity, 0);
    const totalReceived = transactions.filter(t => t.type === "in").reduce((s, t) => s + t.quantity, 0);
    const totalDispensed = transactions.filter(t => t.type === "out").reduce((s, t) => s + t.quantity, 0);
    const dispensedByDrug: Record<string, number> = {};
    transactions.filter(t => t.type === "out").forEach(t => {
      const d = drugs.find(dr => dr.id === t.drugId);
      if (d) dispensedByDrug[d.name] = (dispensedByDrug[d.name] || 0) + t.quantity;
    });
    const mostDispensed = Object.entries(dispensedByDrug).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const valueByCategory: Record<string, number> = {};
    drugs.forEach(d => {
      valueByCategory[d.category || "Autre"] = (valueByCategory[d.category || "Autre"] || 0) + d.stock * d.buyPrice;
    });
    const expiring60 = drugs.filter(d => {
      const days = daysUntilExpiry(d.expiration);
      return days !== null && days <= 60 && days > 0;
    }).sort((a, b) => (daysUntilExpiry(a.expiration) ?? 999) - (daysUntilExpiry(b.expiration) ?? 999));
    return { totalValue, revenueToday, revenueMonth, totalReceived, totalDispensed, mostDispensed, valueByCategory, expiring60 };
  }, [drugs, transactions]);

  return (
    <div className="space-y-4">
      {alerts.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="w-4 h-4 text-warning" />
              <span className="text-sm font-semibold">{t("pharm.alerts")} ({alerts.length})</span>
            </div>
            <ul className="space-y-1">
              {alerts.slice(0, 6).map((a, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${a.type === "out" ? "text-destructive" : a.type === "expiring" ? "text-warning" : "text-warning"}`} />
                  <span>{a.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="inventory">{t("pharm.inventory")}</TabsTrigger>
          <TabsTrigger value="receive">{t("pharm.receive")}</TabsTrigger>
          <TabsTrigger value="dispense">{t("pharm.dispense")}</TabsTrigger>
          <TabsTrigger value="transactions">{t("pharm.transactions")}</TabsTrigger>
          <TabsTrigger value="stats">{t("pharm.stats")}</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="mt-3">
          <InventoryTab drugs={drugs} transactions={transactions} onRefresh={load} />
        </TabsContent>
        <TabsContent value="receive" className="mt-3">
          <ReceiveTab drugs={drugs} onRefresh={load} />
        </TabsContent>
        <TabsContent value="dispense" className="mt-3">
          <DispenseTab drugs={drugs} patients={patients} onRefresh={load} />
        </TabsContent>
        <TabsContent value="transactions" className="mt-3">
          <TransactionsTab transactions={transactions} drugs={drugs} patients={patients} />
        </TabsContent>
        <TabsContent value="stats" className="mt-3">
          <PharmacyStatsTab stats={stats} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============ Inventory Tab ============ */
function InventoryTab({ drugs, transactions, onRefresh }: { drugs: Drug[]; transactions: DrugTransaction[]; onRefresh: () => void }) {
  const { t } = useLang();
  const { user } = useAuth();
  const actor = user?.name || "unknown";
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("az");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editDrug, setEditDrug] = useState<Drug | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Drug | null>(null);
  const [form, setForm] = useState({ name: "", category: "Consommable ortho", stock: "", unit: "unité", buyPrice: "", sellPrice: "", expiration: "", minStock: "5", supplier: "", batchNumber: "", location: "" });

  const totalDispensedMap = useMemo(() => {
    const map = new Map<number, number>();
    transactions.filter(tx => tx.type === "out").forEach(tx => {
      map.set(tx.drugId, (map.get(tx.drugId) || 0) + tx.quantity);
    });
    return map;
  }, [transactions]);

  const sorted = useMemo(() => {
    let list = drugs.filter(d =>
      (d.name.toLowerCase().includes(search.toLowerCase()) || d.category.toLowerCase().includes(search.toLowerCase())) &&
      (filterCategory === "all" || d.category === filterCategory) &&
      (filterStatus === "all" || d.status === filterStatus)
    );
    switch (sortKey) {
      case "az": list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "stock": list.sort((a, b) => a.stock - b.stock); break;
      case "expiry": list.sort((a, b) => (a.expiration ?? "9999").localeCompare(b.expiration ?? "9999")); break;
      case "category": list.sort((a, b) => a.category.localeCompare(b.category)); break;
    }
    return list;
  }, [drugs, search, sortKey, filterCategory, filterStatus]);

  const resetForm = () => setForm({ name: "", category: "Consommable ortho", stock: "", unit: "unité", buyPrice: "", sellPrice: "", expiration: "", minStock: "5", supplier: "", batchNumber: "", location: "" });

  const saveDrug = async () => {
    if (!form.name.trim()) return;
    const now = new Date().toISOString();
    const cid = localStorage.getItem("divinelink.clinicId") || undefined;
    const stockVal = parseInt(form.stock) || 0;

    if (editDrug?.id) {
      await db.drugs.update(editDrug.id, {
        name: form.name.trim(), category: form.category.trim(), stock: stockVal,
        unit: form.unit, buyPrice: parseFloat(form.buyPrice) || 0, sellPrice: parseFloat(form.sellPrice) || 0,
        expiration: form.expiration || undefined, minStock: parseInt(form.minStock) || 5,
        supplier: form.supplier || undefined, batchNumber: form.batchNumber || undefined,
        location: form.location || undefined, updatedAt: now,
        status: computeStatus({ ...editDrug, stock: stockVal, expiration: form.expiration || undefined, minStock: parseInt(form.minStock) || 5 }),
      });
      await logAudit("drug_update", actor, { resource: "drug", resourceId: editDrug.id, message: `${form.name} · stock=${stockVal} ${form.unit} (was ${editDrug.stock})` });
      toast.success(t("common.save"));
      setEditDrug(null);
    } else {
      const drug: Omit<Drug, "id"> = {
        name: form.name.trim(), category: form.category.trim(), stock: stockVal,
        initialStock: stockVal, unit: form.unit,
        buyPrice: parseFloat(form.buyPrice) || 0, sellPrice: parseFloat(form.sellPrice) || 0,
        expiration: form.expiration || undefined, minStock: parseInt(form.minStock) || 5,
        supplier: form.supplier || undefined, batchNumber: form.batchNumber || undefined,
        location: form.location || undefined, status: "in_stock", clinicId: cid,
        createdAt: now, updatedAt: now,
      };
      drug.status = computeStatus(drug as Drug);
      const newId = await db.drugs.add(drug as Drug);
      await logAudit("drug_create", actor, { resource: "drug", resourceId: newId, message: `${form.name} · stock=${stockVal} ${form.unit}` });
      toast.success(t("common.save"));
      setAddOpen(false);
    }
    resetForm();
    onRefresh();
  };

  const openEdit = (d: Drug) => {
    setForm({
      name: d.name, category: d.category, stock: String(d.stock), unit: d.unit,
      buyPrice: String(d.buyPrice), sellPrice: String(d.sellPrice),
      expiration: d.expiration || "", minStock: String(d.minStock),
      supplier: d.supplier || "", batchNumber: d.batchNumber || "", location: d.location || "",
    });
    setEditDrug(d);
  };

  const deleteDrug = async (d: Drug) => {
    if (!d.id) return;
    await db.drugs.delete(d.id);
    await logAudit("drug_delete", actor, { resource: "drug", resourceId: d.id, message: `${d.name} (last stock=${d.stock})` });
    toast.success(t("common.delete"));
    setDeleteConfirm(null);
    onRefresh();
  };

  const exportCsv = async () => {
    const rows = sorted.map(d => ({
      Nom: d.name, Catégorie: d.category,
      "Stock initial": d.initialStock ?? "—",
      "Total dispensé": totalDispensedMap.get(d.id!) || 0,
      "Restant": d.stock, Unité: d.unit,
      "Prix achat": d.buyPrice, "Prix vente": d.sellPrice,
      Expiration: d.expiration || "—", Fournisseur: d.supplier || "—",
      "N° lot": d.batchNumber || "—", Emplacement: d.location || "—",
      Statut: d.status, "Ajouté le": fmtDateTime(d.createdAt),
    }));
    const ok = await saveFile(withDateStamp("inventaire_pharmacie") + ".csv", toCsv(rows as Record<string, unknown>[]), "csv");
    if (ok) toast.success(t("download.done"));
  };

  const DrugForm = () => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>{t("pharm.name")} *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div>
          <Label>{t("pharm.category")}</Label>
          <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DRUG_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("pharm.unit")}</Label>
          <Input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
        </div>
        <div><Label>{t("pharm.stock")}</Label><Input type="number" value={form.stock} onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} /></div>
        <div><Label>{t("pharm.minStock")}</Label><Input type="number" value={form.minStock} onChange={e => setForm(f => ({ ...f, minStock: e.target.value }))} /></div>
        <div><Label>{t("pharm.buyPrice")}</Label><Input type="number" value={form.buyPrice} onChange={e => setForm(f => ({ ...f, buyPrice: e.target.value }))} /></div>
        <div><Label>{t("pharm.sellPrice")}</Label><Input type="number" value={form.sellPrice} onChange={e => setForm(f => ({ ...f, sellPrice: e.target.value }))} /></div>
        <div><Label>{t("pharm.expiration")}</Label><Input type="date" value={form.expiration} onChange={e => setForm(f => ({ ...f, expiration: e.target.value }))} /></div>
        <div><Label>{t("pharm.supplier")}</Label><Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} /></div>
        <div><Label>{t("pharm.batchNumber")}</Label><Input value={form.batchNumber} onChange={e => setForm(f => ({ ...f, batchNumber: e.target.value }))} /></div>
        <div><Label>{t("pharm.location")}</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t("pharm.search")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
          <SelectTrigger className="w-36">
            <ArrowUpDown className="w-3.5 h-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="az">{t("pharm.sort.az")}</SelectItem>
            <SelectItem value="stock">{t("pharm.sort.stock")}</SelectItem>
            <SelectItem value="expiry">{t("pharm.sort.expiry")}</SelectItem>
            <SelectItem value="category">{t("pharm.sort.category")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-36"><SelectValue placeholder={t("pharm.filterCategory")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pharm.allCategories")}</SelectItem>
            {DRUG_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue placeholder={t("pharm.allStatuses")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pharm.allStatuses")}</SelectItem>
            <SelectItem value="in_stock">{t("pharm.in_stock")}</SelectItem>
            <SelectItem value="low">{t("pharm.low")}</SelectItem>
            <SelectItem value="out">{t("pharm.out")}</SelectItem>
            <SelectItem value="expiring_soon">{t("pharm.expiring_soon")}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} className="gap-1"><Download className="w-4 h-4" />{t("pharm.exportCsv")}</Button>
        <Button onClick={() => { resetForm(); setAddOpen(true); }} className="gap-1"><Plus className="w-4 h-4" />{t("pharm.addDrug")}</Button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">{t("common.noData")}</p>
      ) : (
        <div className="grid gap-3">
          {sorted.map(d => {
            const dispensed = totalDispensedMap.get(d.id!) || 0;
            const remaining = d.stock;
            const isLow = remaining <= d.minStock;
            const daysLeft = daysUntilExpiry(d.expiration);
            const expiryUrgent = daysLeft !== null && daysLeft < 30;
            return (
              <Card key={d.id} className={`border-l-4 ${d.status === "out" ? "border-l-destructive" : d.status === "low" ? "border-l-warning" : d.status === "expiring_soon" ? "border-l-orange-400" : "border-l-success"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-base">{d.name}</span>
                        <Badge variant="outline" className="text-xs">{d.category}</Badge>
                        <Badge variant="outline" className="text-xs">{STATUS_ICONS[d.status]} {t(`pharm.${d.status}`)}</Badge>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-sm mt-2">
                        <div>
                          <p className="text-xs text-muted-foreground">{t("pharm.initialStock")}</p>
                          <p className="font-medium">{d.initialStock ?? "—"} {d.unit}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t("pharm.totalDispensed")}</p>
                          <p className="font-medium">{dispensed} {d.unit}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t("pharm.remaining")}</p>
                          <p className={`text-xl font-bold leading-tight ${isLow ? "text-destructive" : "text-foreground"}`}>{remaining} {d.unit}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t("pharm.expiration")}</p>
                          {d.expiration ? (
                            <p className={`font-medium text-sm ${expiryUrgent ? "text-destructive font-bold" : ""}`}>
                              {new Date(d.expiration).toLocaleDateString()}
                              {daysLeft !== null && daysLeft <= 60 && <span className="text-xs ml-1">({daysLeft}j)</span>}
                            </p>
                          ) : <p className="text-muted-foreground">—</p>}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t("pharm.buyPrice")}</p>
                          <p className="font-medium">{d.buyPrice} FCFA</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t("pharm.sellPrice")}</p>
                          <p className="font-medium">{d.sellPrice} FCFA</p>
                        </div>
                        {d.supplier && (
                          <div>
                            <p className="text-xs text-muted-foreground">{t("pharm.supplier")}</p>
                            <p className="font-medium text-sm truncate">{d.supplier}</p>
                          </div>
                        )}
                        {d.batchNumber && (
                          <div>
                            <p className="text-xs text-muted-foreground">{t("pharm.batchNumber")}</p>
                            <p className="font-medium font-mono text-sm">{d.batchNumber}</p>
                          </div>
                        )}
                        {d.location && (
                          <div>
                            <p className="text-xs text-muted-foreground">{t("pharm.location")}</p>
                            <p className="font-medium text-sm">{d.location}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground">{t("pharm.addedAt")}</p>
                          <p className="text-xs">{fmtDateTime(d.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(d)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteConfirm(d)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add drug dialog */}
      <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("pharm.addDrug")}</DialogTitle></DialogHeader>
          <DrugForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>{t("common.cancel")}</Button>
            <Button onClick={saveDrug}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit drug dialog */}
      <Dialog open={!!editDrug} onOpenChange={v => { if (!v) { setEditDrug(null); resetForm(); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("common.edit")}: {editDrug?.name}</DialogTitle></DialogHeader>
          <DrugForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditDrug(null); resetForm(); }}>{t("common.cancel")}</Button>
            <Button onClick={saveDrug}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("pharm.confirmDelete")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{deleteConfirm?.name}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && deleteDrug(deleteConfirm)}>{t("common.delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============ Receive Stock Tab ============ */
function ReceiveTab({ drugs, onRefresh }: { drugs: Drug[]; onRefresh: () => void }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [drugId, setDrugId] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [expiry, setExpiry] = useState("");
  const [supplier, setSupplier] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [notes, setNotes] = useState("");

  const selectedDrug = drugs.find(d => d.id === parseInt(drugId));

  const save = async () => {
    if (!drugId || !qty) return;
    const q = parseInt(qty);
    if (!selectedDrug) return;
    const now = new Date().toISOString();
    const cid = localStorage.getItem("divinelink.clinicId") || undefined;
    const stockBefore = selectedDrug.stock;
    const stockAfter = stockBefore + q;

    await db.drugTransactions.add({
      drugId: selectedDrug.id!, type: "in", quantity: q,
      price: parseFloat(price) || selectedDrug.buyPrice,
      batchNumber: batchNumber || undefined,
      performedBy: user?.name || undefined,
      stockBefore, stockAfter, notes: notes || undefined,
      clinicId: cid, createdAt: now,
    });
    await db.drugs.update(selectedDrug.id!, {
      stock: stockAfter, updatedAt: now,
      expiration: expiry || selectedDrug.expiration,
      supplier: supplier || selectedDrug.supplier,
      batchNumber: batchNumber || selectedDrug.batchNumber,
      buyPrice: parseFloat(price) || selectedDrug.buyPrice,
    });
    await logAudit("drug_receive", user?.name || "unknown", {
      resource: "drug", resourceId: selectedDrug.id,
      message: `${selectedDrug.name} +${q} ${selectedDrug.unit} (${stockBefore}→${stockAfter})${supplier ? ` · ${supplier}` : ""}`
    });
    toast.success(t("common.save"));
    setDrugId(""); setQty(""); setPrice(""); setExpiry(""); setSupplier(""); setBatchNumber(""); setNotes("");
    onRefresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowDown className="w-5 h-5 text-success" />{t("pharm.receive")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>{t("pharm.drug")} *</Label>
          <Select value={drugId} onValueChange={v => { setDrugId(v); const d = drugs.find(dr => dr.id === parseInt(v)); if (d) setPrice(String(d.buyPrice)); }}>
            <SelectTrigger><SelectValue placeholder="Choisir médicament..." /></SelectTrigger>
            <SelectContent>{drugs.map(d => <SelectItem key={d.id} value={d.id!.toString()}>{d.name} ({d.stock} {d.unit})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("pharm.qty")} *</Label><Input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} /></div>
          <div><Label>{t("pharm.buyPrice")}</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} /></div>
          <div><Label>{t("pharm.expiration")}</Label><Input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></div>
          <div><Label>{t("pharm.supplier")}</Label><Input value={supplier} onChange={e => setSupplier(e.target.value)} /></div>
          <div><Label>{t("pharm.batchNumber")}</Label><Input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} /></div>
        </div>
        {selectedDrug && qty && (
          <p className="text-sm text-muted-foreground">
            Stock après réception: <span className="font-bold text-success">{selectedDrug.stock + (parseInt(qty) || 0)} {selectedDrug.unit}</span>
          </p>
        )}
        <div><Label>{t("pharm.notes")}</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        <Button onClick={save} disabled={!drugId || !qty} className="w-full">{t("common.save")}</Button>
      </CardContent>
    </Card>
  );
}

/* ============ Dispense Tab ============ */
function DispenseTab({ drugs, patients, onRefresh }: { drugs: Drug[]; patients: Patient[]; onRefresh: () => void }) {
  const { t } = useLang();
  const { user } = useAuth();
  const [drugId, setDrugId] = useState("");
  const [qty, setQty] = useState("");
  const [patientId, setPatientId] = useState("__none__");
  const [price, setPrice] = useState("");
  const [payStatus, setPayStatus] = useState<PaymentStatus>("unpaid");
  const [exitReason, setExitReason] = useState<ExitReason>("dispensed");
  const [batchNumber, setBatchNumber] = useState("");
  const [notes, setNotes] = useState("");

  const selectedDrug = drugs.find(d => d.id === parseInt(drugId));
  const available = drugs.filter(d => d.stock > 0);

  const save = async () => {
    if (!drugId || !qty) return;
    const q = parseInt(qty);
    if (!selectedDrug) return;
    if (q > selectedDrug.stock) { toast.error(t("pharm.insufficientStock")); return; }
    const now = new Date().toISOString();
    const cid = localStorage.getItem("divinelink.clinicId") || undefined;
    const stockBefore = selectedDrug.stock;
    const stockAfter = stockBefore - q;

    await db.drugTransactions.add({
      drugId: selectedDrug.id!, type: "out", quantity: q,
      price: parseFloat(price) || selectedDrug.sellPrice,
      patientId: patientId !== "__none__" ? parseInt(patientId) : undefined,
      paymentStatus: payStatus,
      exitReason, batchNumber: batchNumber || undefined,
      performedBy: user?.name || undefined,
      stockBefore, stockAfter,
      notes: notes || undefined, clinicId: cid, createdAt: now,
    });
    await db.drugs.update(selectedDrug.id!, { stock: stockAfter, updatedAt: now });
    await logAudit("drug_dispense", user?.name || "unknown", {
      resource: "drug", resourceId: selectedDrug.id,
      message: `${selectedDrug.name} -${q} ${selectedDrug.unit} (${stockBefore}→${stockAfter})${patientId !== "__none__" ? ` · patient#${patientId}` : ""} · ${exitReason} · ${payStatus}`
    });
    toast.success(t("common.save"));
    setDrugId(""); setQty(""); setPatientId("__none__"); setPrice(""); setBatchNumber(""); setNotes("");
    onRefresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUp className="w-5 h-5 text-warning" />{t("pharm.dispense")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>{t("pharm.drug")} *</Label>
          <Select value={drugId} onValueChange={v => { setDrugId(v); const d = drugs.find(dr => dr.id === parseInt(v)); if (d) setPrice(String(d.sellPrice)); }}>
            <SelectTrigger><SelectValue placeholder="Choisir médicament..." /></SelectTrigger>
            <SelectContent>{available.map(d => <SelectItem key={d.id} value={d.id!.toString()}>{d.name} ({d.stock} {d.unit})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("pharm.qty")} *</Label>
            <Input type="number" min={1} max={selectedDrug?.stock} value={qty} onChange={e => setQty(e.target.value)} />
            {selectedDrug && qty && parseInt(qty) > selectedDrug.stock && (
              <p className="text-xs text-destructive mt-1">{t("pharm.insufficientStock")} ({selectedDrug.stock} {selectedDrug.unit})</p>
            )}
          </div>
          <div>
            <Label>{t("pharm.patient")}</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {patients.map(p => <SelectItem key={p.id} value={p.id!.toString()}>{p.firstName} {p.lastName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("pharm.price")}</Label>
            <Input type="number" value={price} onChange={e => setPrice(e.target.value)} />
          </div>
          <div>
            <Label>{t("pharm.paymentStatus")}</Label>
            <Select value={payStatus} onValueChange={v => setPayStatus(v as PaymentStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">{t("pay.status.paid")}</SelectItem>
                <SelectItem value="partial">{t("pay.status.partial")}</SelectItem>
                <SelectItem value="unpaid">{t("pay.status.unpaid")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("pharm.exitReason")}</Label>
            <Select value={exitReason} onValueChange={v => setExitReason(v as ExitReason)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dispensed">{t("pharm.exitReason.dispensed")}</SelectItem>
                <SelectItem value="expired">{t("pharm.exitReason.expired")}</SelectItem>
                <SelectItem value="damaged">{t("pharm.exitReason.damaged")}</SelectItem>
                <SelectItem value="transferred">{t("pharm.exitReason.transferred")}</SelectItem>
                <SelectItem value="other">{t("pharm.exitReason.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>{t("pharm.batchNumber")}</Label><Input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} /></div>
        </div>
        {selectedDrug && qty && parseInt(qty) > 0 && (
          <div className="rounded-md bg-muted p-2 text-sm space-y-0.5">
            <p>{t("pharm.amount")}: <span className="font-bold">{((parseFloat(price) || 0) * parseInt(qty)).toFixed(0)} FCFA</span></p>
            {parseInt(qty) <= selectedDrug.stock && (
              <p>Stock après: <span className="font-bold">{selectedDrug.stock - parseInt(qty)} {selectedDrug.unit}</span></p>
            )}
          </div>
        )}
        <div><Label>{t("pharm.notes")}</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        <Button onClick={save} disabled={!drugId || !qty || (!!selectedDrug && parseInt(qty) > selectedDrug.stock)} className="w-full">{t("common.save")}</Button>
      </CardContent>
    </Card>
  );
}

/* ============ Transactions Tab ============ */
function TransactionsTab({ transactions, drugs, patients }: { transactions: DrugTransaction[]; drugs: Drug[]; patients: Patient[] }) {
  const { t } = useLang();
  const [filterDrug, setFilterDrug] = useState("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");

  const drugName = (id: number) => drugs.find(d => d.id === id)?.name || "—";
  const patientName = (id?: number) => {
    if (!id) return "—";
    const p = patients.find(p => p.id === id);
    return p ? `${p.firstName} ${p.lastName}` : "—";
  };

  const filtered = transactions.filter(tx => {
    if (filterDrug !== "all" && tx.drugId !== parseInt(filterDrug)) return false;
    if (filterType !== "all" && tx.type !== filterType) return false;
    if (search) {
      const s = search.toLowerCase();
      return drugName(tx.drugId).toLowerCase().includes(s) || patientName(tx.patientId).toLowerCase().includes(s);
    }
    return true;
  });

  const exportCsv = async () => {
    const rows = filtered.map(tx => ({
      "Date/Heure": fmtDateTime(tx.createdAt),
      Médicament: drugName(tx.drugId),
      Type: tx.type === "in" ? "Entrée" : "Sortie",
      Quantité: tx.quantity,
      "Stock avant": tx.stockBefore ?? "—",
      "Stock après": tx.stockAfter ?? "—",
      Patient: patientName(tx.patientId),
      Montant: (tx.price * tx.quantity).toFixed(0) + " FCFA",
      "Raison sortie": tx.exitReason ? t(`pharm.exitReason.${tx.exitReason}`) : "—",
      "N° lot": tx.batchNumber || "—",
      "Effectué par": tx.performedBy || "—",
      Notes: tx.notes || "",
    }));
    const ok = await saveFile(withDateStamp("transactions_pharmacie") + ".csv", toCsv(rows as Record<string, unknown>[]), "csv");
    if (ok) toast.success(t("download.done"));
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t("pharm.search")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterDrug} onValueChange={setFilterDrug}>
          <SelectTrigger className="w-44"><SelectValue placeholder={t("pharm.filterDrug")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pharm.filterDrug")}</SelectItem>
            {drugs.map(d => <SelectItem key={d.id} value={d.id!.toString()}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pharm.filterType")}</SelectItem>
            <SelectItem value="in">{t("pharm.in")}</SelectItem>
            <SelectItem value="out">{t("pharm.txOut")}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} className="gap-1 ml-auto"><Download className="w-4 h-4" />{t("pharm.exportCsv")}</Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("pharm.date")}</TableHead>
              <TableHead>{t("pharm.drug")}</TableHead>
              <TableHead>{t("pharm.type")}</TableHead>
              <TableHead className="text-right">{t("pharm.qty")}</TableHead>
              <TableHead className="text-right">{t("pharm.stockBefore")} → {t("pharm.stockAfter")}</TableHead>
              <TableHead>{t("pharm.patient")}</TableHead>
              <TableHead className="text-right">{t("pharm.amount")}</TableHead>
              <TableHead>{t("pharm.exitReason")}</TableHead>
              <TableHead>{t("pharm.batchNumber")}</TableHead>
              <TableHead>{t("pharm.performedBy")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">{t("common.noData")}</TableCell></TableRow>
            ) : filtered.slice(0, 100).map(tx => (
              <TableRow key={tx.id}>
                <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(tx.createdAt)}</TableCell>
                <TableCell className="font-medium text-sm">{drugName(tx.drugId)}</TableCell>
                <TableCell><Badge variant={tx.type === "in" ? "default" : "secondary"}>{tx.type === "in" ? t("pharm.in") : t("pharm.out")}</Badge></TableCell>
                <TableCell className="text-right font-mono">{tx.quantity}</TableCell>
                <TableCell className="text-right text-xs">
                  {tx.stockBefore !== undefined ? `${tx.stockBefore} → ${tx.stockAfter}` : "—"}
                </TableCell>
                <TableCell className="text-xs">{patientName(tx.patientId)}</TableCell>
                <TableCell className="text-right text-sm">{(tx.price * tx.quantity).toFixed(0)} FCFA</TableCell>
                <TableCell className="text-xs">{tx.exitReason ? t(`pharm.exitReason.${tx.exitReason}`) : "—"}</TableCell>
                <TableCell className="text-xs font-mono">{tx.batchNumber || "—"}</TableCell>
                <TableCell className="text-xs">{tx.performedBy || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ============ Stats Tab ============ */
function PharmacyStatsTab({ stats }: {
  stats: {
    totalValue: number; revenueToday: number; revenueMonth: number;
    totalReceived: number; totalDispensed: number;
    mostDispensed: [string, number][];
    valueByCategory: Record<string, number>;
    expiring60: Drug[];
  }
}) {
  const { t } = useLang();

  return (
    <div className="grid md:grid-cols-2 gap-3">
      <Card>
        <CardHeader><CardTitle className="text-base">{t("pharm.totalValue")}</CardTitle></CardHeader>
        <CardContent><p className="text-3xl font-bold">{stats.totalValue.toFixed(0)} FCFA</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("pharm.revenue")}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <p className="text-sm">{t("pharm.today")}: <span className="font-bold">{stats.revenueToday.toFixed(0)} FCFA</span></p>
          <p className="text-sm">{t("pharm.thisMonth")}: <span className="font-bold">{stats.revenueMonth.toFixed(0)} FCFA</span></p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Entrées / Sorties</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <p className="text-sm">Total reçu: <span className="font-bold text-success">{stats.totalReceived}</span></p>
          <p className="text-sm">Total dispensé: <span className="font-bold text-warning">{stats.totalDispensed}</span></p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("pharm.mostDispensed")}</CardTitle></CardHeader>
        <CardContent>
          {stats.mostDispensed.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
            <ul className="space-y-1">{stats.mostDispensed.map(([name, count]) => (
              <li key={name} className="flex justify-between text-sm"><span className="truncate">{name}</span><Badge variant="secondary">{count}</Badge></li>
            ))}</ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Valeur par catégorie</CardTitle></CardHeader>
        <CardContent>
          {Object.entries(stats.valueByCategory).length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
            <ul className="space-y-1">
              {Object.entries(stats.valueByCategory).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
                <li key={cat} className="flex justify-between text-sm"><span>{cat}</span><span className="font-mono">{val.toFixed(0)} FCFA</span></li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Expire dans 60 jours</CardTitle></CardHeader>
        <CardContent>
          {stats.expiring60.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
            <ul className="space-y-1">{stats.expiring60.map(d => {
              const days = daysUntilExpiry(d.expiration);
              return (
                <li key={d.id} className="flex justify-between items-center text-sm">
                  <span className="truncate">{d.name}</span>
                  <Badge variant="outline" className={`ml-2 flex-shrink-0 ${days !== null && days < 15 ? "bg-red-50 text-red-700 border-red-300" : "bg-orange-50 text-orange-700 border-orange-300"}`}>
                    {days}j
                  </Badge>
                </li>
              );
            })}</ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
