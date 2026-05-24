import React, { useEffect, useState, useMemo, useCallback } from "react";
import { db, type Patient, type Consultation } from "@/lib/db";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Search, FileText, Users, Link2, Upload, X, Bold, Italic, List, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { decryptPatients } from "@/lib/patientCrypto";
import { compressImage, fileToDataUrl } from "@/lib/imageUtils";
import { patientPaymentSummary, paymentBadgeEmoji } from "@/lib/patientHelpers";

// ── Types ──────────────────────────────────────────────────────────────────

interface WorkspaceNote {
  id: string;
  title: string;
  content: string;
  tag: string;
  patientId?: number;
  createdAt: string;
  updatedAt: string;
}

interface CaseGroup {
  id: string;
  name: string;
  description: string;
  patientIds: number[];
  notes: string;
  createdAt: string;
}

interface WorkspaceDoc {
  id: string;
  name: string;
  data: string;
  type: string;
  size: number;
  createdAt: string;
}

interface WorkspaceData {
  watchedPatients: number[];
  notes: WorkspaceNote[];
  caseGroups: CaseGroup[];
  documents: WorkspaceDoc[];
}

const EMPTY_WORKSPACE: WorkspaceData = {
  watchedPatients: [],
  notes: [],
  caseGroups: [],
  documents: [],
};

const NOTE_TAGS = ["complex", "research", "followup", "personal"] as const;
type NoteTag = (typeof NOTE_TAGS)[number];

const TAG_COLORS: Record<NoteTag, string> = {
  complex: "bg-red-100 text-red-800 border-red-300",
  research: "bg-blue-100 text-blue-800 border-blue-300",
  followup: "bg-green-100 text-green-800 border-green-300",
  personal: "bg-gray-100 text-gray-800 border-gray-300",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadWorkspace(userId: number): WorkspaceData {
  try {
    const raw = localStorage.getItem(`dl_workspace_${userId}`);
    if (!raw) return { ...EMPTY_WORKSPACE };
    return { ...EMPTY_WORKSPACE, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_WORKSPACE };
  }
}

function saveWorkspace(userId: number, data: WorkspaceData) {
  localStorage.setItem(`dl_workspace_${userId}`, JSON.stringify(data));
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Component ───────────────────────────────────────────────────────────────

export function WorkspacePage() {
  const { user } = useAuth();
  const { t } = useLang();
  const userId = user?.id ?? 0;

  // ── Workspace state ─────────────────────────────────────────────────────
  const [ws, setWs] = useState<WorkspaceData>(() => loadWorkspace(userId));

  // Persist on change
  useEffect(() => {
    if (userId) saveWorkspace(userId, ws);
  }, [ws, userId]);

  // ── DB data ──────────────────────────────────────────────────────────────
  const [allPatients, setAllPatients] = useState<Patient[]>([]);
  const [decryptedPatients, setDecryptedPatients] = useState<Patient[]>([]);
  const [allConsultations, setAllConsultations] = useState<Consultation[]>([]);

  useEffect(() => {
    (async () => {
      const [p, c] = await Promise.all([db.patients.toArray(), db.consultations.toArray()]);
      setAllPatients(p);
      setAllConsultations(c);
      try {
        const dp = await decryptPatients(p);
        setDecryptedPatients(dp);
      } catch {
        setDecryptedPatients(p);
      }
    })();
  }, []);

  // Patient lookup maps
  const patientMap = useMemo(() => {
    const m = new Map<number, Patient>();
    for (const p of allPatients) {
      if (p.id) m.set(p.id, p);
    }
    return m;
  }, [allPatients]);

  const decryptedPatientMap = useMemo(() => {
    const m = new Map<number, Patient>();
    for (const p of decryptedPatients) {
      if (p.id) m.set(p.id, p);
    }
    return m;
  }, [decryptedPatients]);

  // Last consultation per patient
  const lastConsultMap = useMemo(() => {
    const m = new Map<number, Consultation>();
    for (const c of allConsultations) {
      const existing = m.get(c.patientId);
      if (!existing || new Date(c.date) > new Date(existing.date)) {
        m.set(c.patientId, c);
      }
    }
    return m;
  }, [allConsultations]);

  // ── Tab 1: Watched patients ──────────────────────────────────────────────
  const [addPatientOpen, setAddPatientOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);

  const watchedPatientsList = useMemo(() => {
    return ws.watchedPatients
      .map((pid) => decryptedPatientMap.get(pid))
      .filter(Boolean) as Patient[];
  }, [ws.watchedPatients, decryptedPatientMap]);

  const filteredAllPatients = useMemo(() => {
    const q = patientSearch.toLowerCase();
    if (!q) return decryptedPatients;
    return decryptedPatients.filter(
      (p) =>
        p.firstName.toLowerCase().includes(q) ||
        p.lastName.toLowerCase().includes(q) ||
        (p.anonCode || p.patientId).toLowerCase().includes(q)
    );
  }, [patientSearch, decryptedPatients]);

  const addWatchedPatient = useCallback(
    (patientId: number) => {
      if (ws.watchedPatients.includes(patientId)) {
        toast.error("Patient deja suivi");
        return;
      }
      setWs((prev) => ({
        ...prev,
        watchedPatients: [...prev.watchedPatients, patientId],
      }));
      setAddPatientOpen(false);
      toast.success("Patient ajoute");
    },
    [ws.watchedPatients]
  );

  const removeWatchedPatient = useCallback((patientId: number) => {
    setWs((prev) => ({
      ...prev,
      watchedPatients: prev.watchedPatients.filter((id) => id !== patientId),
    }));
  }, []);

  // ── Tab 2: Notes ────────────────────────────────────────────────────────
  const [noteSearch, setNoteSearch] = useState("");
  const [editingNote, setEditingNote] = useState<WorkspaceNote | null>(null);
  const [newNoteOpen, setNewNoteOpen] = useState(false);

  // Debounce auto-save for note content
  const [noteDebounce, setNoteDebounce] = useState<NodeJS.Timeout | null>(null);

  const updateNoteInState = useCallback(
    (id: string, updates: Partial<WorkspaceNote>) => {
      setWs((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === id
            ? { ...n, ...updates, updatedAt: new Date().toISOString() }
            : n
        ),
      }));
    },
    []
  );

  const handleNoteContentChange = useCallback(
    (id: string, content: string) => {
      // Immediate local state update
      if (editingNote && editingNote.id === id) {
        setEditingNote((prev) => prev ? { ...prev, content } : null);
      }
      // Debounced persist
      if (noteDebounce) clearTimeout(noteDebounce);
      const timer = setTimeout(() => {
        updateNoteInState(id, { content });
      }, 300);
      setNoteDebounce(timer);
    },
    [noteDebounce, updateNoteInState, editingNote]
  );

  const handleNoteTitleChange = useCallback(
    (id: string, title: string) => {
      if (editingNote && editingNote.id === id) {
        setEditingNote((prev) => prev ? { ...prev, title } : null);
      }
      if (noteDebounce) clearTimeout(noteDebounce);
      const timer = setTimeout(() => {
        updateNoteInState(id, { title });
      }, 300);
      setNoteDebounce(timer);
    },
    [noteDebounce, updateNoteInState, editingNote]
  );

  const createNote = useCallback(() => {
    const now = new Date().toISOString();
    const note: WorkspaceNote = {
      id: uid(),
      title: "",
      content: "",
      tag: "personal",
      createdAt: now,
      updatedAt: now,
    };
    setWs((prev) => ({ ...prev, notes: [note, ...prev.notes] }));
    setEditingNote(note);
    setNewNoteOpen(false);
  }, []);

  const deleteNote = useCallback((id: string) => {
    setWs((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id) }));
    setEditingNote(null);
  }, []);

  const filteredNotes = useMemo(() => {
    if (!noteSearch) return ws.notes;
    const q = noteSearch.toLowerCase();
    return ws.notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tag.toLowerCase().includes(q)
    );
  }, [ws.notes, noteSearch]);

  // Text formatting helpers (simple markdown wrapping)
  const wrapSelection = useCallback(
    (wrapper: string) => {
      if (!editingNote) return;
      const textarea = document.getElementById(
        `ws-note-content-${editingNote.id}`
      ) as HTMLTextAreaElement | null;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const current = editingNote.content;
      const selected = current.slice(start, end);
      const before = current.slice(0, start);
      const after = current.slice(end);
      const newContent = before + wrapper + selected + wrapper + after;
      handleNoteContentChange(editingNote.id, newContent);
      // Restore cursor
      setTimeout(() => {
        textarea.focus();
        textarea.selectionStart = start + wrapper.length;
        textarea.selectionEnd = end + wrapper.length;
      }, 0);
    },
    [editingNote, handleNoteContentChange]
  );

  // ── Tab 3: Case groups ──────────────────────────────────────────────────
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", description: "", notes: "" });
  const [addPatientToGroupOpen, setAddPatientToGroupOpen] = useState<string | null>(null);
  const [groupPatientSearch, setGroupPatientSearch] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const createGroup = useCallback(() => {
    if (!groupForm.name.trim()) {
      toast.error("Nom du groupe requis");
      return;
    }
    const group: CaseGroup = {
      id: uid(),
      name: groupForm.name.trim(),
      description: groupForm.description.trim(),
      patientIds: [],
      notes: groupForm.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    setWs((prev) => ({ ...prev, caseGroups: [...prev.caseGroups, group] }));
    setGroupForm({ name: "", description: "", notes: "" });
    setNewGroupOpen(false);
    toast.success("Groupe cree");
  }, [groupForm]);

  const deleteGroup = useCallback((id: string) => {
    setWs((prev) => ({
      ...prev,
      caseGroups: prev.caseGroups.filter((g) => g.id !== id),
    }));
    if (expandedGroup === id) setExpandedGroup(null);
  }, [expandedGroup]);

  const addPatientToGroup = useCallback(
    (groupId: string, patientId: number) => {
      setWs((prev) => ({
        ...prev,
        caseGroups: prev.caseGroups.map((g) => {
          if (g.id !== groupId) return g;
          if (g.patientIds.includes(patientId)) return g;
          return { ...g, patientIds: [...g.patientIds, patientId] };
        }),
      }));
    },
    []
  );

  const removePatientFromGroup = useCallback(
    (groupId: string, patientId: number) => {
      setWs((prev) => ({
        ...prev,
        caseGroups: prev.caseGroups.map((g) => {
          if (g.id !== groupId) return g;
          return {
            ...g,
            patientIds: g.patientIds.filter((id) => id !== patientId),
          };
        }),
      }));
    },
    []
  );

  const updateGroupNotes = useCallback(
    (groupId: string, notes: string) => {
      setWs((prev) => ({
        ...prev,
        caseGroups: prev.caseGroups.map((g) =>
          g.id === groupId ? { ...g, notes } : g
        ),
      }));
    },
    []
  );

  // Combined timeline for a case group
  const getGroupTimeline = useCallback(
    (group: CaseGroup): Consultation[] => {
      return allConsultations
        .filter((c) => group.patientIds.includes(c.patientId))
        .sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );
    },
    [allConsultations]
  );

  // ── Tab 4: Documents ────────────────────────────────────────────────────
  const [previewDoc, setPreviewDoc] = useState<WorkspaceDoc | null>(null);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const newDocs: WorkspaceDoc[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          let data: string;
          if (file.type.startsWith("image/")) {
            data = await compressImage(file);
          } else {
            data = await fileToDataUrl(file);
          }
          newDocs.push({
            id: uid(),
            name: file.name,
            data,
            type: file.type,
            size: file.size,
            createdAt: new Date().toISOString(),
          });
        } catch {
          toast.error(`Erreur: ${file.name}`);
        }
      }
      if (newDocs.length > 0) {
        setWs((prev) => ({
          ...prev,
          documents: [...newDocs, ...prev.documents],
        }));
        toast.success(`${newDocs.length} document(s) ajoute(s)`);
      }
      // Reset input
      e.target.value = "";
    },
    []
  );

  const deleteDoc = useCallback((id: string) => {
    setWs((prev) => ({
      ...prev,
      documents: prev.documents.filter((d) => d.id !== id),
    }));
    if (previewDoc?.id === id) setPreviewDoc(null);
  }, [previewDoc]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">{t("ws.title")}</h1>

      <Tabs defaultValue="watched" className="w-full">
        <TabsList className="w-full grid grid-cols-5">
          <TabsTrigger value="watched" className="text-xs sm:text-sm">
            <FileText className="w-4 h-4 mr-1" />
            {t("ws.watched")}
          </TabsTrigger>
          <TabsTrigger value="notes" className="text-xs sm:text-sm">
            <FileText className="w-4 h-4 mr-1" />
            {t("ws.notes")}
          </TabsTrigger>
          <TabsTrigger value="cases" className="text-xs sm:text-sm">
            <Users className="w-4 h-4 mr-1" />
            {t("ws.cases")}
          </TabsTrigger>
          <TabsTrigger value="docs" className="text-xs sm:text-sm">
            <Upload className="w-4 h-4 mr-1" />
            {t("ws.docs")}
          </TabsTrigger>
          <TabsTrigger value="stats" className="text-xs sm:text-sm">
            📊 Stats
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Watched Patients ──────────────────────────────────── */}
        <TabsContent value="watched" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-700">
              {t("ws.watched")}
            </h2>
            <Button
              onClick={() => setAddPatientOpen(true)}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("ws.addPatient")}
            </Button>
          </div>

          {watchedPatientsList.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t("ws.noWatched")}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {watchedPatientsList.map((p) => {
                const lastConsult = p.id ? lastConsultMap.get(p.id) : undefined;
                const displayCode = p.anonCode || p.patientId;
                const isExpanded = expandedPatient === p.id;

                return (
                  <Card
                    key={p.id}
                    className="border-slate-200 hover:border-blue-300 transition-colors cursor-pointer"
                  >
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div
                          className="flex-1"
                          onClick={() =>
                            setExpandedPatient(isExpanded ? null : p.id!)
                          }
                        >
                          <p className="font-semibold text-slate-800 text-base">
                            {displayCode}
                          </p>
                          {isExpanded && (
                            <p className="text-sm text-slate-600 mt-1">
                              {p.firstName} {p.lastName}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {p.id && (
                            <PaymentBadge patientId={p.id} />
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeWatchedPatient(p.id!)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="text-sm text-slate-600 space-y-1">
                        <p>
                          <span className="text-slate-500">
                            {t("ws.lastVisit")} :
                          </span>{" "}
                          {lastConsult
                            ? formatDate(lastConsult.date)
                            : "—"}
                        </p>
                        <p>
                          <span className="text-slate-500">
                            {t("ws.lastDx")} :
                          </span>{" "}
                          {lastConsult?.diagnosis || "—"}
                        </p>
                      </div>

                      {/* Vital-signs sparkline (consultation count over last 8 weeks) */}
                      <PatientSparkline patientId={p.id!} consultations={allConsultations} />

                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-slate-100 text-sm text-slate-600 space-y-1">
                          <p>
                            <span className="font-medium">ID :</span>{" "}
                            {p.patientId}
                          </p>
                          {p.phone && (
                            <p>
                              <span className="font-medium">Tel :</span>{" "}
                              {p.phone}
                            </p>
                          )}
                          {p.dob && (
                            <p>
                              <span className="font-medium">
                                {t("patient.dob")} :
                              </span>{" "}
                              {formatDate(p.dob)}
                            </p>
                          )}
                          {p.medicalAlerts && (
                            <p>
                              <span className="font-medium">
                                {t("patient.alerts")} :
                              </span>{" "}
                              {p.medicalAlerts}
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Add patient dialog */}
          <Dialog open={addPatientOpen} onOpenChange={setAddPatientOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("ws.addPatient")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder={t("ws.searchPatients")}
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {filteredAllPatients
                    .filter((p) => !ws.watchedPatients.includes(p.id!))
                    .slice(0, 50)
                    .map((p) => (
                      <button
                        key={p.id}
                        className="w-full text-left px-3 py-2 rounded-md hover:bg-blue-50 transition-colors text-sm"
                        onClick={() => addWatchedPatient(p.id!)}
                      >
                        <span className="font-medium">
                          {p.anonCode || p.patientId}
                        </span>{" "}
                        — {p.firstName} {p.lastName}
                      </button>
                    ))}
                  {filteredAllPatients.filter(
                    (p) => !ws.watchedPatients.includes(p.id!)
                  ).length === 0 && (
                    <p className="text-muted-foreground text-sm text-center py-4">
                      {t("patient.noResults")}
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAddPatientOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ── Tab 2: Personal Notes ────────────────────────────────────── */}
        <TabsContent value="notes" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-700">
              {t("ws.notes")}
            </h2>
            <Button
              onClick={() => createNote()}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("ws.addNote")}
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={t("ws.searchNotes")}
              value={noteSearch}
              onChange={(e) => setNoteSearch(e.target.value)}
            />
          </div>

          {ws.notes.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t("ws.noNotes")}
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Note list */}
              <div className="lg:col-span-1 space-y-2 max-h-[60vh] overflow-y-auto">
                {filteredNotes.map((n) => (
                  <button
                    key={n.id}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      editingNote?.id === n.id
                        ? "border-blue-400 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                    onClick={() => setEditingNote(n)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-800 truncate text-sm">
                        {n.title || t("ws.noteTitle")}
                      </p>
                      <Badge
                        variant="outline"
                        className={`text-xs shrink-0 ${TAG_COLORS[n.tag as NoteTag] || ""}`}
                      >
                        {t(`ws.tag.${n.tag}`)}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {formatDateTime(n.updatedAt)}
                    </p>
                    {n.patientId && decryptedPatientMap.has(n.patientId) && (
                      <p className="text-xs text-blue-600 mt-1">
                        <Link2 className="w-3 h-3 inline mr-1" />
                        {decryptedPatientMap.get(n.patientId)?.anonCode ||
                          decryptedPatientMap.get(n.patientId)?.patientId}
                      </p>
                    )}
                  </button>
                ))}
              </div>

              {/* Note editor */}
              <div className="lg:col-span-2">
                {editingNote ? (
                  <Card className="border-slate-200">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Input
                          className="text-lg font-semibold border-none px-0 shadow-none focus-visible:ring-0"
                          placeholder={t("ws.noteTitle")}
                          value={editingNote.title}
                          onChange={(e) =>
                            handleNoteTitleChange(editingNote.id, e.target.value)
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteNote(editingNote.id)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Tag selection */}
                      <div className="flex flex-wrap gap-2">
                        {NOTE_TAGS.map((tag) => (
                          <button
                            key={tag}
                            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                              editingNote.tag === tag
                                ? TAG_COLORS[tag]
                                : "border-slate-200 text-slate-500 hover:border-slate-400"
                            }`}
                            onClick={() => {
                              updateNoteInState(editingNote.id, { tag });
                              setEditingNote((prev) =>
                                prev ? { ...prev, tag } : null
                              );
                            }}
                          >
                            {t(`ws.tag.${tag}`)}
                          </button>
                        ))}
                      </div>

                      {/* Link to patient */}
                      <div className="flex items-center gap-2">
                        <Label className="text-sm text-slate-600 shrink-0">
                          {t("ws.linkPatient")}
                        </Label>
                        <Select
                          value={
                            editingNote.patientId?.toString() || "none"
                          }
                          onValueChange={(val) => {
                            const pid = val === "none" ? undefined : parseInt(val, 10);
                            updateNoteInState(editingNote.id, {
                              patientId: pid,
                            });
                            setEditingNote((prev) =>
                              prev ? { ...prev, patientId: pid } : null
                            );
                          }}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            {watchedPatientsList.map((p) => (
                              <SelectItem
                                key={p.id}
                                value={p.id!.toString()}
                              >
                                {p.anonCode || p.patientId} — {p.firstName}{" "}
                                {p.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Formatting toolbar */}
                      <div className="flex items-center gap-1 border-b border-slate-200 pb-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => wrapSelection("**")}
                          title="Bold"
                        >
                          <Bold className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => wrapSelection("*")}
                          title="Italic"
                        >
                          <Italic className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => wrapSelection("- ")}
                          title="List"
                        >
                          <List className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Content area */}
                      <Textarea
                        id={`ws-note-content-${editingNote.id}`}
                        className="min-h-[200px] resize-y text-base"
                        placeholder={t("ws.noteContent")}
                        value={editingNote.content}
                        onChange={(e) =>
                          handleNoteContentChange(
                            editingNote.id,
                            e.target.value
                          )
                        }
                      />

                      <p className="text-xs text-slate-400">
                        {t("ts.lastEdited")}: {formatDateTime(editingNote.updatedAt)}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="flex items-center justify-center h-48 text-muted-foreground">
                    {t("ws.noNotes")}
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 3: Case Groups ───────────────────────────────────────── */}
        <TabsContent value="cases" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-700">
              {t("ws.cases")}
            </h2>
            <Button
              onClick={() => setNewGroupOpen(true)}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("ws.newGroup")}
            </Button>
          </div>

          {ws.caseGroups.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t("ws.noGroups")}
            </p>
          ) : (
            <div className="space-y-4">
              {ws.caseGroups.map((group) => {
                const isExpanded = expandedGroup === group.id;
                const timeline = getGroupTimeline(group);

                return (
                  <Card
                    key={group.id}
                    className="border-slate-200"
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div
                          className="flex-1 cursor-pointer"
                          onClick={() =>
                            setExpandedGroup(isExpanded ? null : group.id)
                          }
                        >
                          <p className="font-semibold text-slate-800 text-base">
                            {group.name}
                          </p>
                          {group.description && (
                            <p className="text-sm text-slate-600 mt-1">
                              {group.description}
                            </p>
                          )}
                          <p className="text-xs text-slate-500 mt-1">
                            {group.patientIds.length} patient(s) —{" "}
                            {formatDateTime(group.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setAddPatientToGroupOpen(group.id)
                            }
                            className="text-blue-600 hover:bg-blue-50"
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteGroup(group.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Linked patients */}
                      <div className="flex flex-wrap gap-2">
                        {group.patientIds.map((pid) => {
                          const dp = decryptedPatientMap.get(pid);
                          const code = dp
                            ? dp.anonCode || dp.patientId
                            : `#${pid}`;
                          return (
                            <Badge
                              key={pid}
                              variant="outline"
                              className="text-sm border-blue-300 text-blue-700 bg-blue-50"
                            >
                              {code}
                              <button
                                className="ml-1 hover:text-red-600"
                                onClick={() =>
                                  removePatientFromGroup(group.id, pid)
                                }
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          );
                        })}
                        {group.patientIds.length === 0 && (
                          <span className="text-xs text-slate-400">
                            Aucun patient lie
                          </span>
                        )}
                      </div>

                      {/* Expanded view */}
                      {isExpanded && (
                        <div className="space-y-3 pt-3 border-t border-slate-100">
                          {/* Shared notes */}
                          <div>
                            <Label className="text-sm font-medium text-slate-700">
                              {t("ws.groupNotes")}
                            </Label>
                            <Textarea
                              className="mt-1 min-h-[80px] text-sm"
                              value={group.notes}
                              onChange={(e) =>
                                updateGroupNotes(group.id, e.target.value)
                              }
                            />
                          </div>

                          {/* Combined timeline */}
                          {timeline.length > 0 && (
                            <div>
                              <Label className="text-sm font-medium text-slate-700">
                                Chronologie commune
                              </Label>
                              <div className="mt-1 space-y-2 max-h-48 overflow-y-auto">
                                {timeline.slice(0, 20).map((c) => {
                                  const dp = decryptedPatientMap.get(
                                    c.patientId
                                  );
                                  const code = dp
                                    ? dp.anonCode || dp.patientId
                                    : `#${c.patientId}`;
                                  return (
                                    <div
                                      key={c.id}
                                      className="flex items-center gap-3 text-sm p-2 rounded bg-slate-50"
                                    >
                                      <span className="text-xs text-slate-500 w-20 shrink-0">
                                        {formatDate(c.date)}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className="text-xs border-blue-300 text-blue-700"
                                      >
                                        {code}
                                      </Badge>
                                      <span className="text-slate-700 truncate">
                                        {c.diagnosis || "—"}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* New group dialog */}
          <Dialog open={newGroupOpen} onOpenChange={setNewGroupOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("ws.newGroup")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>{t("ws.groupName")}</Label>
                  <Input
                    className="mt-1"
                    value={groupForm.name}
                    onChange={(e) =>
                      setGroupForm((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>{t("ws.groupDesc")}</Label>
                  <Textarea
                    className="mt-1"
                    value={groupForm.description}
                    onChange={(e) =>
                      setGroupForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>{t("ws.groupNotes")}</Label>
                  <Textarea
                    className="mt-1"
                    value={groupForm.notes}
                    onChange={(e) =>
                      setGroupForm((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setNewGroupOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={createGroup}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {t("common.add")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Add patient to group dialog */}
          <Dialog
            open={addPatientToGroupOpen !== null}
            onOpenChange={(open) => {
              if (!open) setAddPatientToGroupOpen(null);
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("ws.addPatientToGroup")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder={t("ws.searchPatients")}
                    value={groupPatientSearch}
                    onChange={(e) => setGroupPatientSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {addPatientToGroupOpen &&
                    decryptedPatients
                      .filter((p) => {
                        const group = ws.caseGroups.find(
                          (g) => g.id === addPatientToGroupOpen
                        );
                        if (!group) return false;
                        if (group.patientIds.includes(p.id!)) return false;
                        const q = groupPatientSearch.toLowerCase();
                        if (!q) return true;
                        return (
                          p.firstName.toLowerCase().includes(q) ||
                          p.lastName.toLowerCase().includes(q) ||
                          (p.anonCode || p.patientId)
                            .toLowerCase()
                            .includes(q)
                        );
                      })
                      .slice(0, 30)
                      .map((p) => (
                        <button
                          key={p.id}
                          className="w-full text-left px-3 py-2 rounded-md hover:bg-blue-50 transition-colors text-sm"
                          onClick={() => {
                            addPatientToGroup(addPatientToGroupOpen!, p.id!);
                            setAddPatientToGroupOpen(null);
                            setGroupPatientSearch("");
                          }}
                        >
                          <span className="font-medium">
                            {p.anonCode || p.patientId}
                          </span>{" "}
                          — {p.firstName} {p.lastName}
                        </button>
                      ))}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setAddPatientToGroupOpen(null);
                    setGroupPatientSearch("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ── Tab 4: Personal Documents ────────────────────────────────── */}
        <TabsContent value="docs" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-700">
              {t("ws.docs")}
            </h2>
            <label className="cursor-pointer">
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
                asChild
              >
                <span>
                  <Upload className="w-4 h-4 mr-1" />
                  {t("ws.uploadDoc")}
                </span>
              </Button>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleFileUpload}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              />
            </label>
          </div>

          {ws.documents.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t("ws.noDocs")}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {ws.documents.map((doc) => (
                <Card
                  key={doc.id}
                  className="border-slate-200 hover:border-blue-300 transition-colors"
                >
                  <CardContent className="p-3 space-y-2">
                    {/* Image preview */}
                    {doc.type.startsWith("image/") && (
                      <div
                        className="w-full h-32 bg-slate-100 rounded overflow-hidden cursor-pointer"
                        onClick={() => setPreviewDoc(doc)}
                      >
                        <img
                          src={doc.data}
                          alt={doc.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    {/* Non-image icon */}
                    {!doc.type.startsWith("image/") && (
                      <div
                        className="w-full h-32 bg-slate-100 rounded flex items-center justify-center cursor-pointer"
                        onClick={() => setPreviewDoc(doc)}
                      >
                        <FileText className="w-12 h-12 text-slate-400" />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-slate-800 truncate">
                          {doc.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatFileSize(doc.size)} —{" "}
                          {formatDate(doc.createdAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteDoc(doc.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Document preview dialog */}
          <Dialog
            open={previewDoc !== null}
            onOpenChange={(open) => {
              if (!open) setPreviewDoc(null);
            }}
          >
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{previewDoc?.name}</DialogTitle>
              </DialogHeader>
              {previewDoc && (
                <div className="space-y-3">
                  {previewDoc.type.startsWith("image/") ? (
                    <div className="w-full max-h-[70vh] overflow-auto">
                      <img
                        src={previewDoc.data}
                        alt={previewDoc.name}
                        className="max-w-full mx-auto"
                      />
                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">
                      <FileText className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                      <p>{previewDoc.type} — {formatFileSize(previewDoc.size)}</p>
                    </div>
                  )}
                  <div className="text-sm text-slate-500">
                    <p>
                      {formatFileSize(previewDoc.size)} —{" "}
                      {formatDate(previewDoc.createdAt)}
                    </p>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setPreviewDoc(null)}
                >
                  {t("common.cancel")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
        {/* ── Tab 5: Statistics ─────────────────────────────────────── */}
        <TabsContent value="stats" className="space-y-4 mt-4">
          <StatsTab consultations={allConsultations} patients={decryptedPatients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Small badge showing payment status emoji for a watched patient. */
function PaymentBadge({ patientId }: { patientId: number }) {
  const [status, setStatus] = useState<"paid" | "partial" | "unpaid">("paid");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const summary = await patientPaymentSummary(patientId);
      if (!cancelled) setStatus(summary.status);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return (
    <span className="text-sm" title={status}>
      {paymentBadgeEmoji(status)}
    </span>
  );
}

/** Inline SVG sparkline of consultation frequency over last 8 weeks. */
function PatientSparkline({ patientId, consultations }: { patientId: number; consultations: Consultation[] }) {
  const data = useMemo(() => {
    const weeks = 8;
    const now = Date.now();
    const buckets = new Array(weeks).fill(0);
    consultations
      .filter(c => c.patientId === patientId && c.isLatest !== false)
      .forEach(c => {
        const t = new Date(c.date || c.createdAt).getTime();
        const diffWeeks = Math.floor((now - t) / (7 * 86400000));
        if (diffWeeks >= 0 && diffWeeks < weeks) buckets[weeks - 1 - diffWeeks]++;
      });
    return buckets;
  }, [patientId, consultations]);
  const max = Math.max(1, ...data);
  const w = 120, h = 24;
  const step = w / (data.length - 1 || 1);
  const points = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="text-[10px] text-slate-500">Activité 8 sem.</span>
      <svg width={w} height={h} className="text-blue-500">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
        {data.map((v, i) => (
          <circle key={i} cx={i * step} cy={h - (v / max) * h} r={1.5} fill="currentColor" />
        ))}
      </svg>
      <span className="text-[10px] text-slate-500">{data.reduce((a, b) => a + b, 0)} cons.</span>
    </div>
  );
}

/** Statistics tab with bar chart, pie chart, and lost-patients list. */
function StatsTab({ consultations, patients }: { consultations: Consultation[]; patients: Patient[] }) {
  const latest = useMemo(() => consultations.filter(c => c.isLatest !== false), [consultations]);

  const weeklyBars = useMemo(() => {
    const weeks = 12;
    const now = Date.now();
    const buckets = new Array(weeks).fill(0);
    latest.forEach(c => {
      const diff = Math.floor((now - new Date(c.date || c.createdAt).getTime()) / (7 * 86400000));
      if (diff >= 0 && diff < weeks) buckets[weeks - 1 - diff]++;
    });
    return buckets;
  }, [latest]);

  const topDiagnoses = useMemo(() => {
    const counts: Record<string, number> = {};
    latest.forEach(c => {
      const d = (c.diagnosis || "").trim();
      if (d) counts[d] = (counts[d] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [latest]);
  const totalDx = topDiagnoses.reduce((s, [, n]) => s + n, 0) || 1;
  const PIE_COLORS = ["#3b82f6", "#10b981", "#f97316", "#a855f7", "#ef4444"];

  const lostPatients = useMemo(() => {
    const lastByPatient = new Map<number, string>();
    latest.forEach(c => {
      const d = c.date || c.createdAt;
      const ex = lastByPatient.get(c.patientId);
      if (!ex || d > ex) lastByPatient.set(c.patientId, d);
    });
    const now = Date.now();
    return patients
      .map(p => {
        if (!p.id) return null;
        const last = lastByPatient.get(p.id);
        if (!last) return { p, days: 9999 };
        const days = Math.floor((now - new Date(last).getTime()) / 86400000);
        return days > 90 ? { p, days } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b!.days - a!.days))
      .slice(0, 20) as { p: Patient; days: number }[];
  }, [latest, patients]);

  const maxBar = Math.max(1, ...weeklyBars);

  // Pie slices
  let cumulative = 0;
  const cx = 60, cy = 60, r = 50;
  const slices = topDiagnoses.map(([label, n], i) => {
    const start = cumulative / totalDx;
    cumulative += n;
    const end = cumulative / totalDx;
    const a1 = start * 2 * Math.PI - Math.PI / 2;
    const a2 = end * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const large = end - start > 0.5 ? 1 : 0;
    return { path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`, color: PIE_COLORS[i % PIE_COLORS.length], label, n };
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Consultations / semaine (12 sem.)</h3>
          <svg viewBox="0 0 240 100" className="w-full h-32">
            {weeklyBars.map((v, i) => {
              const bw = 240 / weeklyBars.length;
              const bh = (v / maxBar) * 80;
              return <rect key={i} x={i * bw + 2} y={90 - bh} width={bw - 4} height={bh} fill="#3b82f6" rx={2} />;
            })}
            <line x1={0} y1={90} x2={240} y2={90} stroke="#94a3b8" strokeWidth="0.5" />
          </svg>
          <p className="text-xs text-slate-500 mt-1">Total: {weeklyBars.reduce((a, b) => a + b, 0)} consultations</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Top 5 diagnostics</h3>
          {topDiagnoses.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun diagnostic enregistré.</p>
          ) : (
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 120 120" className="w-28 h-28 flex-shrink-0">
                {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
              </svg>
              <ul className="text-xs space-y-1 flex-1 min-w-0">
                {slices.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 truncate">
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                    <span className="truncate">{s.label}</span>
                    <span className="text-muted-foreground ml-auto">{s.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Patients perdus de vue ({'>'}90 j)</h3>
          {lostPatients.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun patient en alerte.</p>
          ) : (
            <ul className="divide-y text-sm">
              {lostPatients.map(({ p, days }) => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <span className="truncate">{p.anonCode || p.patientId} — {p.firstName} {p.lastName}</span>
                  <Badge variant="destructive" className="text-[10px]">{days === 9999 ? "Jamais vu" : `${days} j`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
