import React, { useEffect, useState } from "react";
import { db, hashPin, type User, type UserRole } from "@/lib/db";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, CreditCard as Edit, UserCog } from "lucide-react";
import { toast } from "sonner";

const roleBadge: Record<UserRole, string> = {
  admin: "bg-red-600 text-white hover:bg-red-600/90",
  doctor: "bg-blue-600 text-white hover:bg-blue-600/90",
  receptionist: "bg-green-600 text-white hover:bg-green-600/90",
};

export function UsersPage() {
  const { t } = useLang();
  const [users, setUsers] = useState<User[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ name: "", role: "receptionist" as UserRole, pin: "", phone: "" });

  const load = async () => setUsers(await db.users.toArray());
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", role: "receptionist", pin: "", phone: "" });
    setDialogOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({ name: u.name, role: u.role, pin: "", phone: u.phone || "" });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name) return;
    if (editing?.id) {
      const update: Partial<User> = { name: form.name, role: form.role, phone: form.phone };
      if (form.pin.length >= 4) update.pinHash = await hashPin(form.pin);
      await db.users.update(editing.id, update);
    } else {
      if (form.pin.length < 4) return toast.error(t("user.pin"));
      await db.users.add({
        name: form.name,
        role: form.role,
        phone: form.phone,
        pinHash: await hashPin(form.pin),
        active: true,
        createdAt: new Date().toISOString(),
      });
    }
    toast.success(t("common.save"));
    setDialogOpen(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} className="gap-2"><Plus className="w-4 h-4" />{t("user.add")}</Button>
      </div>

      <div className="grid gap-3">
        {users.map(u => (
          <Card key={u.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEdit(u)}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <UserCog className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium">{u.name}</p>
                {u.phone && <p className="text-xs text-muted-foreground">{u.phone}</p>}
              </div>
              <Badge className={roleBadge[u.role]}>{t(`user.${u.role}`)}</Badge>
              <Edit className="w-4 h-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? t("common.edit") : t("user.add")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("user.name")} *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>{t("user.role")}</Label>
              <Select value={form.role} onValueChange={(v: UserRole) => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t("user.admin")}</SelectItem>
                  <SelectItem value="doctor">{t("user.doctor")}</SelectItem>
                  <SelectItem value="receptionist">{t("user.receptionist")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("user.phone")} ({t("user.phoneHint")})</Label>
              <Input type="tel" placeholder="+237..." value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>{t("user.pin")} {editing ? "(leave blank to keep)" : "*"}</Label>
              <Input type="password" inputMode="numeric" maxLength={6} value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, "") }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={save}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
