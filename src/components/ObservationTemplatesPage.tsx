import React, { useEffect, useState } from "react";
import { db, type ConsultationTemplate, type TemplateField, type TemplateFieldType, type TemplateSpecialty } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, ArrowUp, ArrowDown, Save, Type, AlignLeft, CheckSquare, ListChecks, Activity, Scale } from "lucide-react";
import { toast } from "sonner";
import { getClinicId } from "@/lib/clinicSettings";
import { TemplateRenderer } from "@/components/TemplateRenderer";

const SPECIALTIES: { v: TemplateSpecialty; label: string }[] = [
  { v: "general", label: "Généraliste" },
  { v: "dental", label: "Dentiste" },
  { v: "orthodontic", label: "Orthodontiste" },
  { v: "other", label: "Autre" },
];

const FIELD_PALETTE: { type: TemplateFieldType; label: string; icon: React.ReactNode }[] = [
  { type: "short_text", label: "Texte court", icon: <Type className="w-4 h-4" /> },
  { type: "long_text", label: "Texte long", icon: <AlignLeft className="w-4 h-4" /> },
  { type: "checkbox", label: "Case à cocher", icon: <CheckSquare className="w-4 h-4" /> },
  { type: "select", label: "Liste déroulante", icon: <ListChecks className="w-4 h-4" /> },
  { type: "vitals", label: "Paramètres vitaux", icon: <Activity className="w-4 h-4" /> },
  { type: "anthropometric", label: "Anthropométrie", icon: <Scale className="w-4 h-4" /> },
];

function emptyTemplate(): ConsultationTemplate {
  const now = new Date().toISOString();
  return { name: "", specialty: "general", fieldsDefinition: [], active: true, clinicId: getClinicId(), createdAt: now, updatedAt: now };
}

export function ObservationTemplatesPage() {
  const [list, setList] = useState<ConsultationTemplate[]>([]);
  const [editing, setEditing] = useState<ConsultationTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, any>>({});

  const load = async () => setList(await db.consultationTemplates.orderBy("createdAt").reverse().toArray());
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error("Nom requis"); return; }
    const now = new Date().toISOString();
    const data = { ...editing, updatedAt: now };
    if (editing.id) await db.consultationTemplates.update(editing.id, data);
    else await db.consultationTemplates.add({ ...data, createdAt: now });
    toast.success("Modèle sauvegardé");
    setEditing(null);
    load();
  };

  const remove = async (id: number) => {
    if (!confirm("Supprimer ce modèle ?")) return;
    await db.consultationTemplates.delete(id);
    load();
  };

  const addField = (type: TemplateFieldType) => {
    if (!editing) return;
    const f: TemplateField = {
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      label: FIELD_PALETTE.find(p => p.type === type)?.label || "Champ",
      options: type === "select" ? ["Option 1", "Option 2"] : undefined,
    };
    setEditing({ ...editing, fieldsDefinition: [...editing.fieldsDefinition, f] });
  };

  const updateField = (i: number, patch: Partial<TemplateField>) => {
    if (!editing) return;
    const arr = [...editing.fieldsDefinition];
    arr[i] = { ...arr[i], ...patch };
    setEditing({ ...editing, fieldsDefinition: arr });
  };

  const removeField = (i: number) => {
    if (!editing) return;
    const arr = editing.fieldsDefinition.filter((_, idx) => idx !== i);
    setEditing({ ...editing, fieldsDefinition: arr });
  };

  const moveField = (i: number, dir: -1 | 1) => {
    if (!editing) return;
    const arr = [...editing.fieldsDefinition];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setEditing({ ...editing, fieldsDefinition: arr });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Modèles d'observation</h2>
        <Button onClick={() => setEditing(emptyTemplate())} className="gap-2"><Plus className="w-4 h-4" />Nouveau modèle</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {list.length === 0 && <p className="text-sm text-muted-foreground">Aucun modèle. Créez-en un pour commencer.</p>}
        {list.map(tpl => (
          <Card key={tpl.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="truncate">{tpl.name}</span>
                <div className="flex items-center gap-1">
                  <Badge variant="outline">{SPECIALTIES.find(s => s.v === tpl.specialty)?.label}</Badge>
                  {tpl.active && <Badge>Actif</Badge>}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{tpl.fieldsDefinition.length} champ(s)</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setEditing(tpl)} className="gap-1"><Pencil className="w-3 h-3" />Modifier</Button>
                <Button size="sm" variant="outline" onClick={() => { setPreviewValues({}); setEditing(tpl); setPreviewOpen(true); }}>Aperçu</Button>
                <Button size="sm" variant="destructive" onClick={() => remove(tpl.id!)} className="gap-1"><Trash2 className="w-3 h-3" />Supprimer</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Editor dialog */}
      <Dialog open={!!editing && !previewOpen} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Modifier le modèle" : "Nouveau modèle"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Nom</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
                <div>
                  <Label>Spécialité</Label>
                  <Select value={editing.specialty} onValueChange={v => setEditing({ ...editing, specialty: v as TemplateSpecialty })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SPECIALTIES.map(s => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={editing.active} onCheckedChange={a => setEditing({ ...editing, active: a })} />
                Modèle actif
              </label>

              <div>
                <Label className="text-xs">Palette de champs</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {FIELD_PALETTE.map(p => (
                    <Button key={p.type} type="button" size="sm" variant="outline" className="gap-1" onClick={() => addField(p.type)}>
                      {p.icon}{p.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Champs ({editing.fieldsDefinition.length})</Label>
                {editing.fieldsDefinition.length === 0 && (
                  <p className="text-xs text-muted-foreground border rounded-md p-3 text-center">Ajoutez des champs depuis la palette ci-dessus.</p>
                )}
                {editing.fieldsDefinition.map((f, i) => (
                  <div key={f.id} className="border rounded-md p-3 space-y-2 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{FIELD_PALETTE.find(p => p.type === f.type)?.label}</Badge>
                      <Input value={f.label} onChange={e => updateField(i, { label: e.target.value })} placeholder="Label" className="flex-1 h-8" />
                      <label className="flex items-center gap-1 text-xs">
                        <Switch checked={!!f.required} onCheckedChange={r => updateField(i, { required: r })} />
                        *
                      </label>
                      <Button size="icon" variant="ghost" onClick={() => moveField(i, -1)} disabled={i === 0}><ArrowUp className="w-3 h-3" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => moveField(i, 1)} disabled={i === editing.fieldsDefinition.length - 1}><ArrowDown className="w-3 h-3" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => removeField(i)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                    {f.type === "select" && (
                      <Input
                        placeholder="Options séparées par des virgules"
                        value={(f.options || []).join(", ")}
                        onChange={e => updateField(i, { options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                        className="h-8"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Annuler</Button>
            <Button onClick={save} className="gap-2"><Save className="w-4 h-4" />Sauvegarder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={o => { if (!o) { setPreviewOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Aperçu — {editing?.name}</DialogTitle></DialogHeader>
          {editing && <TemplateRenderer fields={editing.fieldsDefinition} values={previewValues} onChange={setPreviewValues} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
