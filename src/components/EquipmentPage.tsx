import React, { useCallback, useEffect, useState } from "react";
import { db, type EquipmentItem, type EquipmentMovement } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, History, Package, TriangleAlert as AlertTriangle, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/dateFormat";
import { decryptPatients } from "@/lib/patientCrypto";

// ─── Types ─────────────────────────────────────────────────────────────────

interface MovementDialogState {
  item: EquipmentItem;
  mode: "add" | "remove";
}

interface HistoryDialogState {
  item: EquipmentItem;
  movements: EquipmentMovement[];
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function EquipmentPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [movementDialog, setMovementDialog] = useState<MovementDialogState | null>(null);
  const [historyDialog, setHistoryDialog] = useState<HistoryDialogState | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [patientRef, setPatientRef] = useState("");
  const [patients, setPatients] = useState<{ id: number; name: string }[]>([]);
  const [search, setSearch] = useState("");

  const [renameDialog, setRenameDialog] = useState<EquipmentItem | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    const all = await db.equipmentItems.toArray();
    setItems(all.sort((a, b) => {
      const pa = a.priority ?? 9999;
      const pb = b.priority ?? 9999;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    }));
    const pats = await decryptPatients(await db.patients.toArray());
    setPatients(pats.map(p => ({ id: p.id!, name: `${p.firstName} ${p.lastName}` })));
  }, []);

  const openRename = (item: EquipmentItem) => {
    setRenameDialog(item);
    setRenameValue(item.name);
  };

  const saveRename = async () => {
    if (!renameDialog) return;
    const name = renameValue.trim();
    if (!name) { toast.error("Nom requis"); return; }
    await db.equipmentItems.update(renameDialog.id!, { name, updatedAt: new Date().toISOString() });
    toast.success("Article renommé");
    setRenameDialog(null);
    load();
  };

  const deleteItem = async (item: EquipmentItem) => {
    if (!confirm(`Supprimer définitivement "${item.name}" ?\n\nL'historique des mouvements sera également supprimé.`)) return;
    await db.equipmentMovements.where("itemId").equals(item.id!).delete();
    await db.equipmentItems.delete(item.id!);
    toast.success("Article supprimé");
    load();
  };

  const move = async (item: EquipmentItem, dir: -1 | 1) => {
    // Normalize priorities based on current ordering
    const ordered = [...items];
    const idx = ordered.findIndex(i => i.id === item.id);
    const target = idx + dir;
    if (target < 0 || target >= ordered.length) return;
    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    const now = new Date().toISOString();
    await Promise.all(ordered.map((it, i) =>
      db.equipmentItems.update(it.id!, { priority: i, updatedAt: now })
    ));
    load();
  };

  useEffect(() => { load(); }, [load]);

  const openMovement = (item: EquipmentItem, mode: "add" | "remove") => {
    setMovementDialog({ item, mode });
    setQuantity("1");
    setReason("");
    setPatientRef("");
  };

  const saveMovement = async () => {
    if (!movementDialog) return;
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) { toast.error("Quantité invalide"); return; }
    if (!reason.trim()) { toast.error("Raison requise"); return; }

    const { item, mode } = movementDialog;
    const delta = mode === "add" ? qty : -qty;
    const newStock = item.stock + delta;

    if (newStock < 0) { toast.error("Stock insuffisant"); return; }

    const now = new Date().toISOString();
    const patientId = patientRef ? parseInt(patientRef) : undefined;

    await db.equipmentItems.update(item.id!, { stock: newStock, updatedAt: now });
    await db.equipmentMovements.add({
      itemId: item.id!,
      itemName: item.name,
      quantityChange: delta,
      newStock,
      reason: reason.trim(),
      patientId,
      userName: user?.name || "—",
      createdAt: now,
    });

    toast.success(`Stock mis à jour: ${newStock} unité(s)`);
    setMovementDialog(null);
    load();
  };

  const openHistory = async (item: EquipmentItem) => {
    const movements = await db.equipmentMovements
      .where("itemId")
      .equals(item.id!)
      .reverse()
      .toArray();
    setHistoryDialog({ item, movements });
  };

  const filtered = search.trim()
    ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  const lowStockCount = items.filter(i => i.stock <= i.lowStockThreshold).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Stock d'équipement</h1>
          {lowStockCount > 0 && (
            <p className="text-sm text-orange-600 flex items-center gap-1 mt-0.5">
              <AlertTriangle className="w-4 h-4" />
              {lowStockCount} article(s) en stock faible
            </p>
          )}
        </div>
        <Input
          className="max-w-xs"
          placeholder="Rechercher un article..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((item, idx) => {
          const isLow = item.stock <= item.lowStockThreshold;
          // Disable up/down based on position in the unfiltered list
          const fullIdx = items.findIndex(i => i.id === item.id);
          return (
            <Card key={item.id} className={isLow ? "border-orange-400" : ""}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </span>
                  {isLow && <Badge variant="outline" className="text-orange-600 border-orange-400 shrink-0">Faible</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-bold">{item.stock}</span>
                  <span className="text-xs text-muted-foreground">seuil: {item.lowStockThreshold}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 gap-1 text-green-700 border-green-300 hover:bg-green-50"
                    onClick={() => openMovement(item, "add")}>
                    <Plus className="w-4 h-4" />Ajouter
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 gap-1 text-red-700 border-red-300 hover:bg-red-50"
                    onClick={() => openMovement(item, "remove")}
                    disabled={item.stock === 0}>
                    <Minus className="w-4 h-4" />Retirer
                  </Button>
                  <Button size="sm" variant="ghost" className="px-2" onClick={() => openHistory(item)} title="Historique">
                    <History className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex gap-1 pt-1 border-t">
                  <Button size="sm" variant="ghost" className="px-2 h-8" onClick={() => move(item, -1)}
                    disabled={fullIdx <= 0} title="Monter">
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="px-2 h-8" onClick={() => move(item, 1)}
                    disabled={fullIdx === items.length - 1} title="Descendre">
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="px-2 h-8 ml-auto" onClick={() => openRename(item)} title="Renommer">
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" className="px-2 h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => deleteItem(item)} title="Supprimer">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Rename dialog ── */}
      <Dialog open={!!renameDialog} onOpenChange={v => { if (!v) setRenameDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renommer l'article</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Nouveau nom</Label>
            <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialog(null)}>Annuler</Button>
            <Button onClick={saveRename}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Movement dialog ── */}
      <Dialog open={!!movementDialog} onOpenChange={v => { if (!v) setMovementDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {movementDialog?.mode === "add" ? "Ajouter au stock" : "Retirer du stock"}
            </DialogTitle>
          </DialogHeader>
          {movementDialog && (
            <div className="space-y-4">
              <p className="text-sm font-medium">{movementDialog.item.name}</p>
              <p className="text-xs text-muted-foreground">Stock actuel: {movementDialog.item.stock} unité(s)</p>
              <div>
                <Label>Quantité *</Label>
                <Input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  placeholder="1"
                />
              </div>
              <div>
                <Label>Raison *</Label>
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={movementDialog.mode === "add"
                    ? "Ex: réapprovisionnement, livraison..."
                    : "Ex: utilisé pour patient, consommé..."}
                />
              </div>
              <div>
                <Label>Patient lié (optionnel)</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  value={patientRef}
                  onChange={e => setPatientRef(e.target.value)}
                >
                  <option value="">— Aucun patient —</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementDialog(null)}>Annuler</Button>
            <Button
              onClick={saveMovement}
              className={movementDialog?.mode === "add" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── History dialog ── */}
      <Dialog open={!!historyDialog} onOpenChange={v => { if (!v) setHistoryDialog(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historique — {historyDialog?.item.name}</DialogTitle>
          </DialogHeader>
          {historyDialog && (
            <div className="space-y-2">
              {historyDialog.movements.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Aucun mouvement enregistré</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-2">Date</th>
                      <th className="text-right py-2">Qté</th>
                      <th className="text-right py-2">Nouveau stock</th>
                      <th className="text-left py-2 pl-3">Raison</th>
                      <th className="text-left py-2">Utilisateur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyDialog.movements.map(m => (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-2 text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                        <td className={`py-2 text-right font-medium ${m.quantityChange > 0 ? "text-green-600" : "text-red-600"}`}>
                          {m.quantityChange > 0 ? "+" : ""}{m.quantityChange}
                        </td>
                        <td className="py-2 text-right">{m.newStock}</td>
                        <td className="py-2 pl-3 text-xs">{m.reason}</td>
                        <td className="py-2 text-xs text-muted-foreground">{m.userName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
