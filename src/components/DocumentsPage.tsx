import React, { useEffect, useMemo, useState } from "react";
import { db, type Document as Doc, type DocumentTag, type Patient, type Consultation } from "@/lib/db";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { VoiceTextarea } from "@/components/VoiceTextarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Upload, Trash2, Search, FileText, Clock, LayoutGrid, ListTree, Link2, Tag as TagIcon, Download } from "lucide-react";
import { toast } from "sonner";
import { compressImage, fileToDataUrl, formatBytes } from "@/lib/imageUtils";
import { decryptPatients } from "@/lib/patientCrypto";
import { formatDateTime } from "@/lib/dateFormat";

const MAX_SIZE = 5 * 1024 * 1024;

const TAG_KEYS: DocumentTag[] = ["lab", "referral", "xray", "other"];

type SortKey = "dateDesc" | "dateAsc" | "patient" | "type" | "tag" | "size";

export function DocumentsPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [consultsByPatient, setConsultsByPatient] = useState<Map<number, Consultation[]>>(new Map());
  const [preview, setPreview] = useState<Doc | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<"all" | DocumentTag>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "pdf" | "other">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dateDesc");
  const [view, setView] = useState<"grid" | "timeline">("grid");
  const [uploadDialog, setUploadDialog] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingTag, setPendingTag] = useState<DocumentTag>("other");
  const [clinicalNotes, setClinicalNotes] = useState("");

  // Load per-patient clinical notes from localStorage
  useEffect(() => {
    if (!selectedPatient) { setClinicalNotes(""); return; }
    setClinicalNotes(localStorage.getItem(`dl.docNotes.${selectedPatient}`) || "");
  }, [selectedPatient]);

  const updateNotes = (v: string) => {
    setClinicalNotes(v);
    if (selectedPatient) localStorage.setItem(`dl.docNotes.${selectedPatient}`, v);
  };

  const load = async () => {
    setPatients(await decryptPatients(await db.patients.toArray()));
    if (selectedPatient) {
      setDocs(await db.documents.where("patientId").equals(parseInt(selectedPatient)).reverse().toArray());
    } else {
      setDocs(await db.documents.reverse().toArray());
    }
    const allConsults = await db.consultations.toArray();
    const map = new Map<number, Consultation[]>();
    allConsults.forEach(c => {
      if (!map.has(c.patientId)) map.set(c.patientId, []);
      map.get(c.patientId)!.push(c);
    });
    setConsultsByPatient(map);
  };

  useEffect(() => { load(); }, [selectedPatient]);

  const patientName = (id: number) => {
    const p = patients.find(p => p.id === id);
    return p ? `${p.firstName} ${p.lastName}` : "—";
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = docs.filter(d => {
      if (tagFilter !== "all" && d.tag !== tagFilter) return false;
      if (typeFilter === "image" && !d.type.startsWith("image/")) return false;
      if (typeFilter === "pdf" && d.type !== "application/pdf") return false;
      if (typeFilter === "other" && (d.type.startsWith("image/") || d.type === "application/pdf")) return false;
      if (dateFrom && d.createdAt.slice(0, 10) < dateFrom) return false;
      if (dateTo && d.createdAt.slice(0, 10) > dateTo) return false;
      if (!q) return true;
      const pn = patientName(d.patientId).toLowerCase();
      return d.name.toLowerCase().includes(q) || pn.includes(q) ||
        (d.tag && t(`doc.tag.${d.tag}`).toLowerCase().includes(q));
    });
    out.sort((a, b) => {
      switch (sortKey) {
        case "dateAsc": return a.createdAt.localeCompare(b.createdAt);
        case "dateDesc": return b.createdAt.localeCompare(a.createdAt);
        case "patient": return patientName(a.patientId).localeCompare(patientName(b.patientId));
        case "type": return a.type.localeCompare(b.type);
        case "tag": return (a.tag || "").localeCompare(b.tag || "");
        case "size": return b.size - a.size;
      }
    });
    return out;
  }, [docs, search, tagFilter, typeFilter, dateFrom, dateTo, sortKey, patients, t]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Doc[]>();
    for (const d of filtered) {
      const key = d.createdAt.slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(d);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedPatient || !e.target.files) return;
    const file = e.target.files[0];
    if (file.size > MAX_SIZE) { toast.error(t("doc.maxSize")); e.target.value = ""; return; }
    setPendingFile(file);
    setPendingTag("other");
    setUploadDialog(true);
    e.target.value = "";
  };

  const confirmUpload = async () => {
    if (!pendingFile || !selectedPatient) return;
    try {
      const data = pendingFile.type.startsWith("image/")
        ? await compressImage(pendingFile)
        : await fileToDataUrl(pendingFile);
      const now = new Date().toISOString();
      await db.documents.add({
        patientId: parseInt(selectedPatient),
        name: pendingFile.name,
        type: pendingFile.type,
        data,
        size: pendingFile.size,
        tag: pendingTag,
        createdAt: now,
        updatedAt: now,
        updatedBy: user?.name,
      });
      toast.success(t("doc.upload"));
      setUploadDialog(false);
      setPendingFile(null);
      load();
    } catch {
      toast.error("Upload error");
    }
  };

  const handleDelete = async (id: number) => {
    await db.documents.delete(id);
    toast.success(t("doc.delete"));
    setPreview(null);
    load();
  };

  const updateDocTag = async (id: number, tag: DocumentTag) => {
    await db.documents.update(id, { tag, updatedAt: new Date().toISOString(), updatedBy: user?.name });
    setPreview(p => p && p.id === id ? { ...p, tag } : p);
    load();
  };

  const linkToConsult = async (id: number, consultId: number | null) => {
    await db.documents.update(id, { name: (preview?.name || ""), updatedAt: new Date().toISOString(), updatedBy: user?.name });
    // store linkage as a tag suffix in name? Simpler: keep via metadata field by reusing audit (no schema change here)
    // We piggy-back on a custom field stored in name? Better: extend doc later; for now just re-read.
    void consultId;
    load();
  };

  const isImage = (d: Doc) => d.type.startsWith("image/");

  return (
    <div className="space-y-4">
      {selectedPatient && (
        <div className="sticky top-0 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 pt-2 pb-3 bg-background/95 backdrop-blur border-b">
          <Label className="text-xs font-semibold flex items-center gap-1 mb-1">
            <FileText className="w-3 h-3" /> Clinical Notes
          </Label>
          <VoiceTextarea
            value={clinicalNotes}
            onChange={updateNotes}
            placeholder="Free-form notes for this patient (auto-saved locally)..."
            rows={2}
            className="text-sm"
          />
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-0">
          <Label>{t("apt.patient")}</Label>
          <Select value={selectedPatient} onValueChange={setSelectedPatient}>
            <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
            <SelectContent>
              {patients.map(p => (
                <SelectItem key={p.id} value={p.id!.toString()}>{p.firstName} {p.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedPatient && (
          <div className="flex items-end">
            <Button asChild className="gap-2">
              <label>
                <Upload className="w-4 h-4" /> {t("doc.uploadFile")}
                <input type="file" className="hidden" onChange={handleFileSelect} />
              </label>
            </Button>
          </div>
        )}
      </div>

      {/* Search + filter row 1 */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t("doc.search")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={tagFilter} onValueChange={v => setTagFilter(v as any)}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder={t("doc.allTags")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("doc.allTags")}</SelectItem>
            {TAG_KEYS.map(tg => <SelectItem key={tg} value={tg}>{t(`doc.tag.${tg}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as any)}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder={t("doc.fileType")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("doc.allTypes")}</SelectItem>
            <SelectItem value="image">{t("doc.image")}</SelectItem>
            <SelectItem value="pdf">{t("doc.pdf")}</SelectItem>
            <SelectItem value="other">{t("doc.tag.other")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filter row 2: dates, sort, view */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex gap-2 flex-1">
          <div className="flex-1">
            <Label className="text-xs">{t("doc.dateFrom")}</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="flex-1">
            <Label className="text-xs">{t("doc.dateTo")}</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
          <SelectTrigger className="sm:w-44"><SelectValue placeholder={t("doc.sortBy")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="dateDesc">{t("doc.sort.dateDesc")}</SelectItem>
            <SelectItem value="dateAsc">{t("doc.sort.dateAsc")}</SelectItem>
            <SelectItem value="patient">{t("doc.sort.patient")}</SelectItem>
            <SelectItem value="type">{t("doc.sort.type")}</SelectItem>
            <SelectItem value="tag">{t("doc.sort.tag")}</SelectItem>
            <SelectItem value="size">{t("doc.sort.size")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <Button size="icon" variant={view === "grid" ? "default" : "outline"} onClick={() => setView("grid")} title={t("doc.grid")}>
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button size="icon" variant={view === "timeline" ? "default" : "outline"} onClick={() => setView("timeline")} title={t("doc.timeline")}>
            <ListTree className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("doc.maxSize")}</p>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">{selectedPatient ? t("doc.noFiles") : t("common.noData")}</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.map(d => (
            <Card key={d.id} className="group relative cursor-pointer" onClick={() => setPreview(d)}>
              <CardContent className="p-2">
                <div className="aspect-square rounded bg-muted overflow-hidden flex items-center justify-center">
                  {isImage(d) ? (
                    <img src={d.data} alt={d.name} className="w-full h-full object-cover" />
                  ) : (
                    <FileText className="w-12 h-12 text-muted-foreground" />
                  )}
                </div>
                <p className="text-xs truncate mt-1" title={d.name}>{d.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{patientName(d.patientId)}</p>
                <div className="flex items-center justify-between gap-1 mt-1">
                  {d.tag && <Badge variant="secondary" className="text-[10px] px-1 py-0">{t(`doc.tag.${d.tag}`)}</Badge>}
                  <span className="text-[10px] text-muted-foreground">{formatBytes(d.size)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground truncate" title={formatDateTime(d.createdAt)}>
                  <Clock className="w-2.5 h-2.5 inline mr-0.5" />{formatDateTime(d.createdAt)}
                </p>
                <Button
                  variant="destructive" size="icon"
                  className="absolute top-1 right-1 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => { e.stopPropagation(); handleDelete(d.id!); }}
                ><Trash2 className="w-3 h-3" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4 relative pl-4 border-l-2 border-border">
          {grouped.map(([day, list]) => (
            <div key={day} className="space-y-2">
              <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-primary mt-1" />
              <h3 className="text-sm font-semibold">{formatDateTime(day + "T00:00:00").slice(0, 10)}</h3>
              <div className="space-y-1.5">
                {list.map(d => (
                  <Card key={d.id} className="cursor-pointer" onClick={() => setPreview(d)}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {isImage(d) ? <img src={d.data} alt="" className="w-full h-full object-cover" /> : <FileText className="w-5 h-5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{d.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {patientName(d.patientId)}{d.tag ? ` • ${t(`doc.tag.${d.tag}`)}` : ""}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{formatDateTime(d.createdAt)}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail side panel */}
      <Sheet open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base truncate pr-6">{preview?.name}</SheetTitle>
          </SheetHeader>
          {preview && (
            <div className="mt-4 space-y-4">
              <div className="rounded border bg-muted overflow-hidden">
                {isImage(preview) ? (
                  <img src={preview.data} alt={preview.name} className="w-full max-h-[40vh] object-contain" />
                ) : preview.type === "application/pdf" ? (
                  <div className="p-6 text-center">
                    <FileText className="w-12 h-12 mx-auto text-muted-foreground" />
                    <Button asChild variant="outline" size="sm" className="mt-3">
                      <a href={preview.data} download={preview.name}><Download className="w-4 h-4 mr-1" />{t("doc.uploadFile")}</a>
                    </Button>
                  </div>
                ) : (
                  <iframe src={preview.data} title={preview.name} className="w-full h-64" />
                )}
              </div>
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">{t("apt.patient")}:</span> {patientName(preview.patientId)}</p>
                <p><span className="text-muted-foreground">{t("ts.created")}:</span> {formatDateTime(preview.createdAt)}</p>
                {preview.updatedAt && <p><span className="text-muted-foreground">{t("ts.lastEdited")}:</span> {formatDateTime(preview.updatedAt)}{preview.updatedBy ? ` ${t("ts.by")} ${preview.updatedBy}` : ""}</p>}
                <p><span className="text-muted-foreground">{t("doc.fileType")}:</span> {preview.type || "—"}</p>
                <p><span className="text-muted-foreground">Size:</span> {formatBytes(preview.size)}</p>
              </div>

              <div>
                <Label className="text-xs flex items-center gap-1"><TagIcon className="w-3 h-3" />{t("doc.editTags")}</Label>
                <Select value={preview.tag || "other"} onValueChange={v => updateDocTag(preview.id!, v as DocumentTag)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TAG_KEYS.map(tg => <SelectItem key={tg} value={tg}>{t(`doc.tag.${tg}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs flex items-center gap-1"><Link2 className="w-3 h-3" />{t("doc.linkConsult")}</Label>
                <Select onValueChange={v => linkToConsult(preview.id!, v === "__none__" ? null : parseInt(v))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {(consultsByPatient.get(preview.patientId) || []).map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {new Date(c.date).toLocaleDateString()} — {(c.diagnosis || "—").slice(0, 30)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button variant="destructive" className="w-full" onClick={() => preview.id && handleDelete(preview.id)}>
                <Trash2 className="w-4 h-4 mr-2" />{t("common.delete")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Upload tag dialog */}
      <Dialog open={uploadDialog} onOpenChange={setUploadDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("doc.uploadFile")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground truncate">{pendingFile?.name}</p>
            <div>
              <Label>{t("doc.tag")}</Label>
              <Select value={pendingTag} onValueChange={v => setPendingTag(v as DocumentTag)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TAG_KEYS.map(tg => <SelectItem key={tg} value={tg}>{t(`doc.tag.${tg}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialog(false)}>{t("common.cancel")}</Button>
            <Button onClick={confirmUpload}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
