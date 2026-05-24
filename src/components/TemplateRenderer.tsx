import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TemplateField } from "@/lib/db";

interface Props {
  fields: TemplateField[];
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
}

export function TemplateRenderer({ fields, values, onChange }: Props) {
  const set = (id: string, v: any) => onChange({ ...values, [id]: v });

  // Auto BMI
  const computeBmi = (w?: number, h?: number) =>
    w && h ? +(w / Math.pow(h / 100, 2)).toFixed(1) : undefined;

  return (
    <div className="space-y-3">
      {fields.map(f => {
        const v = values[f.id];
        switch (f.type) {
          case "short_text":
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required && " *"}</Label>
                <Input value={v ?? ""} onChange={e => set(f.id, e.target.value)} />
              </div>
            );
          case "long_text":
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required && " *"}</Label>
                <Textarea value={v ?? ""} onChange={e => set(f.id, e.target.value)} rows={3} />
              </div>
            );
          case "checkbox":
            return (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!v} onCheckedChange={c => set(f.id, !!c)} />
                {f.label}
              </label>
            );
          case "select":
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required && " *"}</Label>
                <Select value={v ?? "__none__"} onValueChange={x => set(f.id, x === "__none__" ? undefined : x)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {(f.options || []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
          case "vitals": {
            const vv = v || {};
            return (
              <div key={f.id} className="border rounded-md p-3 space-y-2">
                <p className="text-xs font-semibold">{f.label}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">TA (mmHg)</Label><Input placeholder="120/80" value={vv.bp ?? ""} onChange={e => set(f.id, { ...vv, bp: e.target.value })} /></div>
                  <div><Label className="text-xs">Pouls (bpm)</Label><Input type="number" value={vv.pulse ?? ""} onChange={e => set(f.id, { ...vv, pulse: parseFloat(e.target.value) || undefined })} /></div>
                  <div><Label className="text-xs">Temp (°C)</Label><Input type="number" step="0.1" value={vv.temperature ?? ""} onChange={e => set(f.id, { ...vv, temperature: parseFloat(e.target.value) || undefined })} /></div>
                  <div><Label className="text-xs">FR (/min)</Label><Input type="number" value={vv.respRate ?? ""} onChange={e => set(f.id, { ...vv, respRate: parseFloat(e.target.value) || undefined })} /></div>
                </div>
              </div>
            );
          }
          case "anthropometric": {
            const aa = v || {};
            const bmi = computeBmi(aa.weight, aa.height);
            return (
              <div key={f.id} className="border rounded-md p-3 space-y-2">
                <p className="text-xs font-semibold">{f.label}</p>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">Poids (kg)</Label><Input type="number" step="0.1" value={aa.weight ?? ""} onChange={e => { const w = parseFloat(e.target.value) || undefined; set(f.id, { ...aa, weight: w, bmi: computeBmi(w, aa.height) }); }} /></div>
                  <div><Label className="text-xs">Taille (cm)</Label><Input type="number" value={aa.height ?? ""} onChange={e => { const h = parseFloat(e.target.value) || undefined; set(f.id, { ...aa, height: h, bmi: computeBmi(aa.weight, h) }); }} /></div>
                  <div><Label className="text-xs">IMC</Label><Input value={bmi ?? aa.bmi ?? ""} readOnly /></div>
                </div>
              </div>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
