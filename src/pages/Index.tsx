import React, { lazy, Suspense, useState, useEffect } from "react";
import { seedDatabase } from "@/lib/db";
import { initCrypto } from "@/lib/crypto";
import { migrateEncryption } from "@/lib/patientCrypto";
import { autoRestoreIfNeeded, installAutoSnapshotHooks, scheduleSnapshot } from "@/lib/emergencyBackup";
import { requestNotificationPermission, initSmartNotifications, stopSmartNotifications } from "@/lib/smartNotifications";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LangProvider } from "@/contexts/LangContext";
import { LoginScreen } from "@/components/LoginScreen";
import { DashboardPage } from "@/components/DashboardPage";
import { ClinicOnboarding } from "@/components/ClinicOnboarding";
import { AppLayout, type Page } from "@/components/AppLayout";
import { isClinicConfigured } from "@/lib/clinicSettings";
import { db } from "@/lib/db";
import { toast } from "sonner";

const PatientsPage = lazy(() => import("@/components/PatientsPage").then(m => ({ default: m.PatientsPage })));
const AgendaPage = lazy(() => import("@/components/AgendaPage").then(m => ({ default: m.AgendaPage })));
const ConsultationsPage = lazy(() => import("@/components/ConsultationsPage").then(m => ({ default: m.ConsultationsPage })));
const DocumentsPage = lazy(() => import("@/components/DocumentsPage").then(m => ({ default: m.DocumentsPage })));
const DiagnosisPage = lazy(() => import("@/components/DiagnosisPage").then(m => ({ default: m.DiagnosisPage })));
const ResearchPage = lazy(() => import("@/components/ResearchPage").then(m => ({ default: m.ResearchPage })));
const PharmacyPage = lazy(() => import("@/components/PharmacyPage").then(m => ({ default: m.PharmacyPage })));
const DentalExamPage = lazy(() => import("@/components/DentalExamPage").then(m => ({ default: m.DentalExamPage })));
const UsersPage = lazy(() => import("@/components/UsersPage").then(m => ({ default: m.UsersPage })));
const BackupPage = lazy(() => import("@/components/BackupPage").then(m => ({ default: m.BackupPage })));
const AuditLogPage = lazy(() => import("@/components/AuditLogPage").then(m => ({ default: m.AuditLogPage })));
const SecurityPage = lazy(() => import("@/components/SecurityPage").then(m => ({ default: m.SecurityPage })));
const ClinicSettingsPage = lazy(() => import("@/components/ClinicSettingsPage").then(m => ({ default: m.ClinicSettingsPage })));
const WorkspacePage = lazy(() => import("@/components/WorkspacePage").then(m => ({ default: m.WorkspacePage })));
const PaymentsPage = lazy(() => import("@/components/PaymentsPage").then(m => ({ default: m.PaymentsPage })));
const EquipmentPage = lazy(() => import("@/components/EquipmentPage").then(m => ({ default: m.EquipmentPage })));
const ObservationTemplatesPage = lazy(() => import("@/components/ObservationTemplatesPage").then(m => ({ default: m.ObservationTemplatesPage })));
const ImportPatientsPage = lazy(() => import("@/components/ImportPatientsPage").then(m => ({ default: m.ImportPatientsPage })));
const ScheduledSyncPage = lazy(() => import("@/components/ScheduledSyncPage").then(m => ({ default: m.ScheduledSyncPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Chargement...</p>
      </div>
    </div>
  );
}

function AppContent() {
  const { user } = useAuth();
  const [page, setPage] = useState<Page>(() => {
    const saved = sessionStorage.getItem("divinelink.currentPage") as Page | null;
    return saved || "dashboard";
  });

  const navigateTo = (p: Page) => {
    sessionStorage.setItem("divinelink.currentPage", p);
    setPage(p);
  };
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (user && !isClinicConfigured()) setShowOnboarding(true);
  }, [user]);

  useEffect(() => {
    if (user) {
      initSmartNotifications(user.name);
    }
    return () => {
      stopSmartNotifications();
    };
  }, [user]);

  // Check for missed reminders on app open
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const now = new Date().toISOString().split("T")[0];
        const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
        const appointments = await db.appointments.toArray();
        const missed = appointments.filter(a => a.date >= twoDaysAgo && a.date < now && a.status === "scheduled");
        if (missed.length > 0) {
          toast.warning(`${missed.length} rendez-vous manqu(s) — consultez les rappels`, { duration: 8000 });
        }
      } catch {}
    })();
  }, [user]);

  if (!user) return <LoginScreen />;

  const isAdmin = user.role === "admin";
  const adminOnly = (node: React.ReactNode): React.ReactNode =>
    isAdmin ? node : <DashboardPage onNavigate={navigateTo} />;

  const pages: Record<Page, React.ReactNode> = {
    dashboard: <DashboardPage onNavigate={navigateTo} />,
    patients: <Suspense fallback={<PageLoader />}><PatientsPage /></Suspense>,
    appointments: <Suspense fallback={<PageLoader />}><AgendaPage /></Suspense>,
    consultations: <Suspense fallback={<PageLoader />}><ConsultationsPage /></Suspense>,
    documents: <Suspense fallback={<PageLoader />}><DocumentsPage /></Suspense>,
    diagnosis: <Suspense fallback={<PageLoader />}><DiagnosisPage /></Suspense>,
    users: adminOnly(<Suspense fallback={<PageLoader />}><UsersPage /></Suspense>),
    backup: adminOnly(<Suspense fallback={<PageLoader />}><BackupPage /></Suspense>),
    audit: adminOnly(<Suspense fallback={<PageLoader />}><AuditLogPage /></Suspense>),
    security: adminOnly(<Suspense fallback={<PageLoader />}><SecurityPage /></Suspense>),
    research: <Suspense fallback={<PageLoader />}><ResearchPage /></Suspense>,
    clinic: <Suspense fallback={<PageLoader />}><ClinicSettingsPage /></Suspense>,
    pharmacy: <Suspense fallback={<PageLoader />}><PharmacyPage /></Suspense>,
    dental: <Suspense fallback={<PageLoader />}><DentalExamPage /></Suspense>,
    workspace: <Suspense fallback={<PageLoader />}><WorkspacePage /></Suspense>,
    payments: <Suspense fallback={<PageLoader />}><PaymentsPage /></Suspense>,
    equipment: <Suspense fallback={<PageLoader />}><EquipmentPage /></Suspense>,
    templates: adminOnly(<Suspense fallback={<PageLoader />}><ObservationTemplatesPage /></Suspense>),
    importPatients: adminOnly(<Suspense fallback={<PageLoader />}><ImportPatientsPage /></Suspense>),
    sync: adminOnly(<Suspense fallback={<PageLoader />}><ScheduledSyncPage /></Suspense>),
  };

  return (
    <>
      <AppLayout currentPage={page} onNavigate={navigateTo}>
        {pages[page]}
      </AppLayout>
      <ClinicOnboarding open={showOnboarding} onDone={() => setShowOnboarding(false)} />
    </>
  );
}

const Index = () => {
  useEffect(() => {
    requestNotificationPermission();
    (async () => {
      await initCrypto();
      // Try silent restore BEFORE seeding so we don't overwrite a recovered admin.
      await autoRestoreIfNeeded();
      await seedDatabase();
      await migrateEncryption();
      installAutoSnapshotHooks();
      // Take an initial snapshot once everything is ready.
      scheduleSnapshot();
    })();
  }, []);

  return (
    <LangProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LangProvider>
  );
};

export default Index;
