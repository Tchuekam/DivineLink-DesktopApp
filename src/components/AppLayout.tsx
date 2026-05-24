import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { LangToggle } from "@/components/LangToggle";
import { GlobalSearch } from "@/components/GlobalSearch";
import { InstallPWAButton } from "@/components/InstallPWAButton";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Users, CalendarDays, Stethoscope, FileImage, UserCog, Database, LogOut, Menu, X, ChevronRight, ChevronDown, RefreshCw, ScrollText, ShieldCheck, ChartBar as BarChart3, PanelLeftClose, PanelLeftOpen, ClipboardList, LayoutGrid, Lock, Chrome as Home, Building2, Pill, Settings, Smile, Bell, BellRing, CreditCard, Package, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { db, hashPin, type User, type UserRole } from "@/lib/db";
import { useIsMobile } from "@/hooks/use-mobile";
import { NotificationBell } from "@/components/NotificationBell";
import { isPushSupported, isSubscribed, enablePushNotifications, disablePushNotifications } from "@/lib/pushNotifications";
import { getClinicId } from "@/lib/clinicSettings";
import { toast } from "sonner";

export type Page =
  | "dashboard" | "patients" | "appointments" | "consultations"
  | "documents" | "diagnosis" | "users" | "backup" | "audit"
  | "security" | "research" | "clinic" | "pharmacy" | "dental" | "payments" | "workspace" | "equipment"
  | "templates" | "importPatients" | "sync";

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: React.ReactNode;
}

interface NavItem { page: Page; icon: React.ReactNode; label: string; roles: string[]; }

const COLLAPSE_KEY = "divinelink.sidebar.collapsed";
const ADMIN_GROUP_KEY = "divinelink.sidebar.adminOpen";

export function AppLayout({ currentPage, onNavigate, children }: Props) {
  const { user, logout, hasRole, login, lockNow, sessionExpiresAt } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const { t } = useLang();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [adminOpen, setAdminOpen] = useState(() => localStorage.getItem(ADMIN_GROUP_KEY) === "1");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [pickedUser, setPickedUser] = useState<User | null>(null);
  const [switchPin, setSwitchPin] = useState("");
  const [switchErr, setSwitchErr] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  // Check push subscription status on mount
  useEffect(() => {
    if (!isPushSupported()) return;
    isSubscribed().then(setPushEnabled);
  }, []);

  const togglePush = async () => {
    if (pushEnabled) {
      await disablePushNotifications();
      setPushEnabled(false);
      toast.success(t("push.disabled"));
    } else {
      const clinicId = getClinicId();
      const result = await enablePushNotifications(user?.id || 0, user?.name || "", clinicId);
      if (result.success) {
        setPushEnabled(true);
        toast.success(t("push.enabled"));
      } else {
        toast.error(result.error === "Permission denied or subscription failed"
          ? t("push.permissionDenied")
          : result.error === "Push notifications not supported in this browser"
          ? t("push.notSupported")
          : t("push.registerFailed"));
      }
    }
  };

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(ADMIN_GROUP_KEY, adminOpen ? "1" : "0");
  }, [adminOpen]);

  useEffect(() => {
    if (switchOpen) {
      db.users.toArray().then(all => setUsers(all.filter(u => u.active !== false)));
      setPickedUser(null);
      setSwitchPin("");
      setSwitchErr(false);
    }
  }, [switchOpen]);

  const handleSwitch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickedUser) return;
    // login() verifies the PIN against the stored per-user salted hash.
    const ok = await login(switchPin);
    if (ok) setSwitchOpen(false); else setSwitchErr(true);
  };

  const roleBadgeClass = (r?: UserRole) =>
    r === "admin" ? "bg-destructive text-destructive-foreground"
    : r === "doctor" ? "bg-primary text-primary-foreground"
    : "bg-secondary text-secondary-foreground";

  // Flat main nav items (always visible based on role)
  const mainNav: NavItem[] = [
    { page: "dashboard", icon: <LayoutDashboard className="w-5 h-5" />, label: t("nav.dashboard"), roles: ["admin", "doctor", "receptionist"] },
    { page: "patients", icon: <Users className="w-5 h-5" />, label: t("nav.patients"), roles: ["admin", "doctor", "receptionist"] },
    { page: "appointments", icon: <CalendarDays className="w-5 h-5" />, label: t("nav.appointments"), roles: ["admin", "doctor", "receptionist"] },
    { page: "consultations", icon: <ClipboardList className="w-5 h-5" />, label: t("nav.consultations"), roles: ["admin", "doctor"] },
    { page: "diagnosis", icon: <Stethoscope className="w-5 h-5" />, label: t("nav.diagnostics"), roles: ["admin", "doctor"] },
    { page: "documents", icon: <FileImage className="w-5 h-5" />, label: t("nav.documents"), roles: ["admin", "doctor"] },
    { page: "research", icon: <BarChart3 className="w-5 h-5" />, label: t("nav.statistics"), roles: ["admin", "doctor"] },
    { page: "dental", icon: <Smile className="w-5 h-5" />, label: t("dental.title"), roles: ["admin", "doctor"] },
  ];

  // Collapsible admin section (collapsed by default, muted style)
  const adminNav: NavItem[] = [
    { page: "payments", icon: <CreditCard className="w-5 h-5" />, label: t("nav.payments"), roles: ["admin", "doctor", "receptionist"] },
    { page: "users", icon: <UserCog className="w-5 h-5" />, label: t("nav.users"), roles: ["admin"] },
    { page: "backup", icon: <Database className="w-5 h-5" />, label: t("nav.backup"), roles: ["admin"] },
    { page: "pharmacy", icon: <Pill className="w-5 h-5" />, label: t("nav.pharmacy"), roles: ["admin"] },
    { page: "security", icon: <ShieldCheck className="w-5 h-5" />, label: t("nav.security"), roles: ["admin"] },
    { page: "audit", icon: <ScrollText className="w-5 h-5" />, label: t("nav.audit"), roles: ["admin"] },
    { page: "clinic", icon: <Building2 className="w-5 h-5" />, label: t("nav.clinic"), roles: ["admin"] },
    { page: "equipment", icon: <Package className="w-5 h-5" />, label: t("nav.equipment"), roles: ["admin", "doctor"] },
    { page: "templates", icon: <ClipboardList className="w-5 h-5" />, label: t("nav.templates"), roles: ["admin"] },
    { page: "importPatients", icon: <Upload className="w-5 h-5" />, label: t("nav.importPatients"), roles: ["admin"] },
    { page: "sync", icon: <RefreshCw className="w-5 h-5" />, label: t("nav.sync"), roles: ["admin"] },
  ];

  const visibleMain = mainNav.filter(i => hasRole(i.roles as any));
  const visibleAdmin = adminNav.filter(i => hasRole(i.roles as any));
  const allItems = [...visibleMain, ...visibleAdmin];
  const currentLabel = allItems.find(i => i.page === currentPage)?.label || "";

  const navigate = (p: Page) => {
    onNavigate(p);
    setSidebarOpen(false);
    import("@/lib/metrics").then(m => m.trackNav(p));
  };

  useEffect(() => { import("@/lib/metrics").then(m => m.trackNav(currentPage)); }, [currentPage]);

  const sidebarWidth = collapsed ? "w-[60px]" : "w-[220px]";

  // ---- Mobile bottom-nav: 5 items ----
  type BottomItem =
    | { kind: "page"; page: Page; icon: React.ReactNode; label: string }
    | { kind: "more"; icon: React.ReactNode; label: string };
  const bottomNav: BottomItem[] = [
    { kind: "page", page: "dashboard", icon: <Home className="w-6 h-6" />, label: t("nav.home") },
    { kind: "page", page: "patients", icon: <Users className="w-6 h-6" />, label: t("nav.patients") },
    { kind: "page", page: "appointments", icon: <CalendarDays className="w-6 h-6" />, label: t("nav.agenda") },
    { kind: "page", page: "consultations", icon: <ClipboardList className="w-6 h-6" />, label: t("nav.consultations") },
    { kind: "more", icon: <LayoutGrid className="w-6 h-6" />, label: t("nav.more") },
  ];

  const moreItems = [
    { page: "payments" as Page, icon: <CreditCard className="w-6 h-6" />, label: t("nav.payments"), roles: ["admin", "doctor", "receptionist"] },
    { page: "diagnosis" as Page, icon: <Stethoscope className="w-6 h-6" />, label: t("nav.diagnostics"), roles: ["admin", "doctor"] },
    { page: "documents" as Page, icon: <FileImage className="w-6 h-6" />, label: t("nav.documents"), roles: ["admin", "doctor"] },
    { page: "research" as Page, icon: <BarChart3 className="w-6 h-6" />, label: t("nav.statistics"), roles: ["admin", "doctor"] },
    { page: "pharmacy" as Page, icon: <Pill className="w-6 h-6" />, label: t("nav.pharmacy"), roles: ["admin"] },
    { page: "dental" as Page, icon: <Smile className="w-6 h-6" />, label: t("dental.title"), roles: ["admin", "doctor"] },
    { page: "users" as Page, icon: <UserCog className="w-6 h-6" />, label: t("nav.users"), roles: ["admin"] },
    { page: "backup" as Page, icon: <Database className="w-6 h-6" />, label: t("nav.backup"), roles: ["admin"] },
    { page: "security" as Page, icon: <ShieldCheck className="w-6 h-6" />, label: t("nav.security"), roles: ["admin"] },
    { page: "audit" as Page, icon: <ScrollText className="w-6 h-6" />, label: t("nav.audit"), roles: ["admin"] },
    { page: "clinic" as Page, icon: <Building2 className="w-6 h-6" />, label: t("nav.clinic"), roles: ["admin"] },
    { page: "equipment" as Page, icon: <Package className="w-6 h-6" />, label: t("nav.equipment"), roles: ["admin", "doctor"] },
  ].filter(i => hasRole(i.roles as any));

  const remainingMs = sessionExpiresAt ? Math.max(0, sessionExpiresAt - Date.now()) : 0;
  const remainingMin = Math.ceil(remainingMs / 60000);

  const renderSidebarNav = (isCollapsed: boolean) => (
    <>
      {/* Main nav — flat list */}
      {visibleMain.map(item => (
        <NavBtn key={item.page} item={item} currentPage={currentPage} collapsed={isCollapsed} onClick={navigate} />
      ))}

      {/* Admin section — collapsible, muted */}
      {visibleAdmin.length > 0 && (
        <div className="mt-2 pt-2 border-t border-sidebar-border/50">
          {!isCollapsed && (
            <button
              onClick={() => setAdminOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-1 text-[10px] font-bold tracking-wider text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors"
            >
              <span className="flex items-center gap-1.5"><Settings className="w-3 h-3" />{t("nav.group.admin")}</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${adminOpen ? "" : "-rotate-90"}`} />
            </button>
          )}
          {(isCollapsed || adminOpen) && visibleAdmin.map(item => (
            <NavBtn key={item.page} item={item} currentPage={currentPage} collapsed={isCollapsed} onClick={navigate} muted />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ── Desktop sidebar: fixed, full height, never scrolls with content ── */}
      {!isMobile && (
        <>
          {/* Overlay for tablet (below lg) when drawer is open */}
          {sidebarOpen && (
            <div className="fixed inset-0 bg-foreground/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          <aside
            className={`
              fixed top-0 left-0 z-50 h-screen
              ${sidebarWidth}
              bg-sidebar text-sidebar-foreground
              flex flex-col
              transition-all duration-300
              ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
            `}
          >
            {/* Logo / brand */}
            <div className="p-3 flex items-center gap-2 border-b border-sidebar-border flex-shrink-0">
              <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
                <Stethoscope className="w-5 h-5 text-sidebar-primary-foreground" />
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <h1 className="font-bold text-sm truncate">DivineLink</h1>
                  <p className="text-xs text-sidebar-foreground/60 truncate">{user?.name} &bull; {user?.role}</p>
                </div>
              )}
              <button onClick={() => setSidebarOpen(false)} className="lg:hidden flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
              <button
                onClick={() => setCollapsed(c => !c)}
                className="hidden lg:block text-sidebar-foreground/70 hover:text-sidebar-foreground flex-shrink-0"
                title={collapsed ? "Expand" : "Collapse"}
              >
                {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
            </div>

            {/* Nav — scrollable within the sidebar */}
            <nav className="flex-1 p-2 space-y-1 overflow-y-auto min-h-0">
              {renderSidebarNav(collapsed)}
            </nav>

            {/* Bottom actions — always visible */}
            <div className="p-2 border-t border-sidebar-border space-y-1 flex-shrink-0">
              <Button
                variant="ghost"
                className={`w-full ${collapsed ? "justify-center px-0" : "justify-start gap-3"} text-sidebar-foreground hover:bg-sidebar-accent/50`}
                onClick={() => setSwitchOpen(true)}
                title={t("role.switchUser")}
              >
                <RefreshCw className="w-5 h-5" />
                {!collapsed && t("role.switchUser")}
              </Button>
              <Button
                variant="ghost"
                className={`w-full ${collapsed ? "justify-center px-0" : "justify-start gap-3"} text-sidebar-foreground hover:bg-sidebar-accent/50`}
                onClick={logout}
                title={t("auth.logout")}
              >
                <LogOut className="w-5 h-5" />
                {!collapsed && t("auth.logout")}
              </Button>
            </div>
          </aside>
        </>
      )}

      {/* ── Main area: offset by sidebar width on desktop ── */}
      <div
        className={`flex flex-col min-h-screen transition-all duration-300 ${
          !isMobile ? (collapsed ? "lg:pl-[60px]" : "lg:pl-[220px]") : ""
        }`}
      >
        {/* ── Top header: sticky, never scrolls away ── */}
        <header className="sticky top-0 z-30 h-14 border-b flex items-center px-4 gap-3 bg-card no-print flex-shrink-0">
          {/* Hamburger — mobile opens drawer, tablet opens sidebar */}
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Menu"
            className={isMobile ? "block" : "lg:hidden"}
          >
            <Menu className="w-5 h-5" />
          </button>

          <h2 className="font-semibold text-base truncate">{currentLabel}</h2>
          <Badge
            className={
              user?.role === "admin"
                ? "bg-destructive text-destructive-foreground"
                : user?.role === "doctor"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground"
            }
          >
            {t(`role.${user?.role}`)}
          </Badge>

          <div className="flex-1 flex justify-end">
            <GlobalSearch onNavigate={onNavigate} />
          </div>

          <Button variant="ghost" size="icon" onClick={() => window.location.reload()} title="Actualiser">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <NotificationBell onNavigate={onNavigate} />

          {isPushSupported() && (
            <button
              onClick={togglePush}
              className={`relative p-2 rounded-md hover:bg-accent transition-colors ${pushEnabled ? "text-primary" : "text-muted-foreground"}`}
              title={pushEnabled ? t("push.disable") : t("push.enable")}
            >
              {pushEnabled ? <BellRing className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
            </button>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
                title={t("session.locksIn")}
              >
                <Lock className="w-4 h-4" />
                {sessionExpiresAt && <span className="hidden sm:inline">{remainingMin}m</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56" align="end">
              <p className="text-sm font-medium">{t("session.locksIn")}</p>
              <p className="text-2xl font-bold mt-1">{remainingMin} min</p>
              <Button size="sm" variant="outline" className="w-full mt-3" onClick={lockNow}>
                <Lock className="w-4 h-4 mr-2" />{t("session.lockNow")}
              </Button>
            </PopoverContent>
          </Popover>

          <InstallPWAButton />
          <LangToggle />
        </header>

        {/* ── Page content: the ONLY thing that scrolls ── */}
        <main className={`flex-1 p-4 md:p-6 overflow-auto animate-fade-in ${isMobile ? "pb-24" : ""}`}>
          {children}
        </main>
      </div>

      {/* Mobile drawer with full menu */}
      {isMobile && sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-foreground/40 z-40" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col">
            <div className="p-3 flex items-center gap-2 border-b border-sidebar-border">
              <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
                <Stethoscope className="w-5 h-5 text-sidebar-primary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-sm truncate">DivineLink</h1>
                <p className="text-xs text-sidebar-foreground/60 truncate">{user?.name}</p>
              </div>
              <button onClick={() => setSidebarOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <nav className="flex-1 p-2 overflow-y-auto space-y-1">
              {renderSidebarNav(false)}
            </nav>
            <div className="p-2 border-t border-sidebar-border space-y-1">
              <Button variant="ghost" className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent/50" onClick={() => { setSwitchOpen(true); setSidebarOpen(false); }}>
                <RefreshCw className="w-5 h-5" /> {t("role.switchUser")}
              </Button>
              <Button variant="ghost" className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent/50" onClick={logout}>
                <LogOut className="w-5 h-5" /> {t("auth.logout")}
              </Button>
            </div>
          </aside>
        </>
      )}

      {/* Mobile bottom nav (5 items) */}
      {isMobile && (
        <nav
          className="fixed bottom-0 inset-x-0 z-30 bg-card flex no-print"
          style={{ height: 65, boxShadow: "0 -4px 12px hsl(var(--foreground) / 0.08)" }}
        >
          {bottomNav.map((item, idx) => {
            const isActive = item.kind === "page"
              ? currentPage === item.page
              : moreItems.some(m => m.page === currentPage);
            return (
              <button
                key={idx}
                onClick={() => item.kind === "page" ? onNavigate(item.page) : setMoreOpen(true)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1 text-[10px] ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {item.icon}
                <span className="truncate max-w-full px-0.5">{item.label}</span>
                {isActive && <span className="w-1 h-1 rounded-full bg-primary" />}
              </button>
            );
          })}
        </nav>
      )}

      {/* More sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t("nav.more")}</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 mt-4 pb-4">
            {moreItems.map(m => (
              <button
                key={m.page}
                onClick={() => { onNavigate(m.page); setMoreOpen(false); }}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border active:scale-95 transition-transform ${
                  currentPage === m.page ? "border-primary bg-primary/5 text-primary" : "bg-card"
                }`}
              >
                {m.icon}
                <span className="text-xs font-medium text-center">{m.label}</span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Switch account dialog */}
      <Dialog open={switchOpen} onOpenChange={setSwitchOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("role.switchUser")}</DialogTitle>
          </DialogHeader>
          {!pickedUser ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => { setPickedUser(u); setSwitchPin(""); setSwitchErr(false); }}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                    <UserCog className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{u.name}</p>
                  </div>
                  <Badge className={roleBadgeClass(u.role)}>{t(`role.${u.role}`)}</Badge>
                </button>
              ))}
              <Button variant="outline" className="w-full mt-2" onClick={() => { setSwitchOpen(false); logout(); }}>
                <LogOut className="w-4 h-4 mr-2" />{t("auth.logout")}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSwitch} className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">{pickedUser.name}</p>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={switchPin}
                onChange={e => { setSwitchPin(e.target.value.replace(/\D/g, "")); setSwitchErr(false); }}
                placeholder={t("auth.pin")}
                className="text-center text-xl tracking-[0.4em] h-12"
                autoFocus
              />
              {switchErr && <p className="text-destructive text-sm text-center">{t("auth.error")}</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setPickedUser(null)}>
                  {t("common.back")}
                </Button>
                <Button type="submit" className="flex-1" disabled={switchPin.length < 4}>
                  {t("auth.login")}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NavBtn({ item, currentPage, collapsed, onClick, muted }: {
  item: NavItem; currentPage: Page; collapsed: boolean; onClick: (p: Page) => void; muted?: boolean;
}) {
  const active = currentPage === item.page;
  return (
    <button
      onClick={() => onClick(item.page)}
      title={collapsed ? item.label : undefined}
      className={`w-full flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-3"} py-2.5 rounded-lg text-sm transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : muted
            ? "text-sidebar-foreground/50 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground/80"
            : "hover:bg-sidebar-accent/50"
      }`}
    >
      {item.icon}
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && active && <ChevronRight className="w-4 h-4 ml-auto" />}
    </button>
  );
}
