import React, { useEffect, useRef, useState } from "react";
import { db, type Patient, type Consultation, type Document as Doc } from "@/lib/db";
import { useLang } from "@/contexts/LangContext";
import { Input } from "@/components/ui/input";
import { Search, User, Stethoscope, FileImage } from "lucide-react";
import type { Page } from "@/components/AppLayout";
import { decryptPatients } from "@/lib/patientCrypto";

interface Props {
  onNavigate: (page: Page) => void;
}

interface PatientHit { type: "patient"; item: Patient }
interface ConsultHit { type: "consultation"; item: Consultation; patient?: Patient }
interface DocHit { type: "document"; item: Doc; patient?: Patient }
type Hit = PatientHit | ConsultHit | DocHit;

/** Global search across patients, consultations and documents.
 *  Performs case-insensitive substring matching against the most useful fields. */
export function GlobalSearch({ onNavigate }: Props) {
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim().toLowerCase();
    if (!q) { setHits([]); return; }
    const timer = setTimeout(() => { import("@/lib/metrics").then(m => m.trackSearch(q)); }, 800);
    (async () => {
      const [patientsRaw, consultations, documents] = await Promise.all([
        db.patients.toArray(),
        db.consultations.toArray(),
        db.documents.toArray(),
      ]);
      const patients = await decryptPatients(patientsRaw);
      if (cancelled) return;
      const patById = new Map(patients.map(p => [p.id!, p]));

      const patientHits: Hit[] = patients
        .filter(p =>
          p.firstName.toLowerCase().includes(q) ||
          p.lastName.toLowerCase().includes(q) ||
          p.patientId.toLowerCase().includes(q) ||
          (p.phone || "").toLowerCase().includes(q)
        )
        .slice(0, 8)
        .map(item => ({ type: "patient", item }));

      const consultHits: Hit[] = consultations
        .filter(c => c.isLatest !== false)
        .filter(c =>
          (c.diagnosis || "").toLowerCase().includes(q) ||
          (c.symptoms || "").toLowerCase().includes(q) ||
          (c.prescription || "").toLowerCase().includes(q) ||
          (c.notes || "").toLowerCase().includes(q) ||
          (c.treatmentPlan || "").toLowerCase().includes(q)
        )
        .slice(0, 8)
        .map(item => ({ type: "consultation", item, patient: patById.get(item.patientId) }));

      const docHits: Hit[] = documents
        .filter(d =>
          d.name.toLowerCase().includes(q) ||
          (d.tag && t(`doc.tag.${d.tag}`).toLowerCase().includes(q))
        )
        .slice(0, 8)
        .map(item => ({ type: "document", item, patient: patById.get(item.patientId) }));

      setHits([...patientHits, ...consultHits, ...docHits]);
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, t]);

  const groups = {
    patient: hits.filter(h => h.type === "patient") as PatientHit[],
    consultation: hits.filter(h => h.type === "consultation") as ConsultHit[],
    document: hits.filter(h => h.type === "document") as DocHit[],
  };

  const goto = (page: Page) => {
    onNavigate(page);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={ref} className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        placeholder={t("search.global")}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="pl-9 h-9"
      />
      {open && query.trim() && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-[60vh] overflow-y-auto">
          {hits.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground text-center">{t("search.noResults")}</p>
          ) : (
            <div className="py-1">
              {groups.patient.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase">{t("search.patients")}</div>
                  {groups.patient.map(h => (
                    <button
                      key={`p-${h.item.id}`}
                      onClick={() => goto("patients")}
                      className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2"
                    >
                      <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm truncate">{h.item.firstName} {h.item.lastName}</div>
                        <div className="text-xs text-muted-foreground truncate">{h.item.patientId} • {h.item.phone || "—"}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {groups.consultation.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase">{t("search.consultations")}</div>
                  {groups.consultation.map(h => (
                    <button
                      key={`c-${h.item.id}`}
                      onClick={() => goto("consultations")}
                      className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2"
                    >
                      <Stethoscope className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm truncate">{h.patient ? `${h.patient.firstName} ${h.patient.lastName}` : "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">{h.item.diagnosis || h.item.symptoms || "—"}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {groups.document.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase">{t("search.documents")}</div>
                  {groups.document.map(h => (
                    <button
                      key={`d-${h.item.id}`}
                      onClick={() => goto("documents")}
                      className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2"
                    >
                      <FileImage className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm truncate">{h.item.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {h.patient ? `${h.patient.firstName} ${h.patient.lastName}` : "—"}
                          {h.item.tag && ` • ${t(`doc.tag.${h.item.tag}`)}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
