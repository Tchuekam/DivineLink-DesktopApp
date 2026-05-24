import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { db, hashPin, verifyPin, type User, type UserRole } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";

interface AuthCtx {
  user: User | null;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
  hasRole: (roles: UserRole[]) => boolean;
  lockNow: () => void;
  sessionExpiresAt: number | null;
  extendSession: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

const AUTOLOCK_KEY = "dl.autolock.minutes.v1";
const SESSION_KEY = "dl.session.v1";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes inactivity

function getAutolockMs(): number {
  const raw = localStorage.getItem(AUTOLOCK_KEY);
  const m = raw == null ? 30 : parseInt(raw, 10);
  if (isNaN(m) || m < 0) return SESSION_TTL_MS;
  if (m === 0) return Number.POSITIVE_INFINITY;
  return m * 60 * 1000;
}

interface SessionPayload { userId: number; expiresAt: number; }

function readSession(): SessionPayload | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionPayload;
    if (!s.userId || !s.expiresAt) return null;
    if (Date.now() > s.expiresAt) { sessionStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}

function writeSession(userId: number) {
  const ttl = Math.min(getAutolockMs(), SESSION_TTL_MS);
  const expiresAt = Date.now() + (Number.isFinite(ttl) ? ttl : SESSION_TTL_MS);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId, expiresAt }));
  return expiresAt;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setSessionExpiresAt(null);
    setUser(null);
  }, []);

  const lockNow = logout;

  // Hydrate session on mount
  useEffect(() => {
    (async () => {
      const s = readSession();
      if (s) {
        const found = await db.users.get(s.userId);
        if (found && found.active) {
          setUser(found);
          setSessionExpiresAt(s.expiresAt);
        } else {
          sessionStorage.removeItem(SESSION_KEY);
        }
      }
      setHydrating(false);
    })();
  }, []);

  const extendSession = useCallback(() => {
    if (!user?.id) return;
    const exp = writeSession(user.id);
    setSessionExpiresAt(exp);
  }, [user]);

  // Activity tracking — extend session on interaction
  useEffect(() => {
    if (!user) return;
    let last = 0;
    const handle = () => {
      const now = Date.now();
      if (now - last < 30000) return; // throttle
      last = now;
      extendSession();
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach(e => window.addEventListener(e, handle, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, handle));
  }, [user, extendSession]);

  // Auto-logout poll
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      const s = readSession();
      if (!s) logout();
      else setSessionExpiresAt(s.expiresAt);
    }, 30000);
    return () => clearInterval(interval);
  }, [user, logout]);

  const login = async (pin: string): Promise<boolean> => {
    // Iterate active users and verify against per-user salted hash.
    const candidates = await db.users.filter(u => !!u.active).toArray();
    let found: User | undefined;
    for (const u of candidates) {
      if (await verifyPin(pin, u.pinHash)) { found = u; break; }
    }
    if (found && found.id) {
      // Transparently upgrade legacy SHA-256 hashes to PBKDF2 on success.
      if (!found.pinHash.startsWith("pbkdf2$")) {
        try {
          const upgraded = await hashPin(pin);
          await db.users.update(found.id, { pinHash: upgraded });
          found = { ...found, pinHash: upgraded };
        } catch { /* non-fatal */ }
      }
      setUser(found);
      const exp = writeSession(found.id);
      setSessionExpiresAt(exp);
      const roleLabel = found.role.charAt(0).toUpperCase() + found.role.slice(1);
      toast.success(`Welcome ${found.name}`, { description: `Logged in as ${roleLabel}` });
      logAudit("login", found.name);
      return true;
    }
    logAudit("login_fail", "(unknown)", { message: "Invalid PIN attempt" });
    return false;
  };

  const hasRole = (roles: UserRole[]) => !!user && roles.includes(user.role);

  if (hydrating) return null;

  return (
    <AuthContext.Provider value={{ user, login, logout, hasRole, lockNow, sessionExpiresAt, extendSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
