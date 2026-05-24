import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { LangToggle } from "@/components/LangToggle";
import { Loader as Loader2 } from "lucide-react";
import { db } from "@/lib/db";

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-100 text-red-700 border-red-300",
  doctor: "bg-blue-100 text-blue-700 border-blue-300",
  receptionist: "bg-emerald-100 text-emerald-700 border-emerald-300",
  assistant: "bg-amber-100 text-amber-700 border-amber-300",
};

export function LoginScreen() {
  const { login } = useAuth();
  const { t } = useLang();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [welcomeRole, setWelcomeRole] = useState<string | null>(null);
  const [welcomeName, setWelcomeName] = useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setLoading(true);
    // Pre-resolve the user so we can show the role badge before navigating
    try {
      const candidates = await db.users.filter(u => !!u.active).toArray();
      const { verifyPin } = await import("@/lib/db");
      let matched: any = null;
      for (const u of candidates) { if (await verifyPin(pin, u.pinHash)) { matched = u; break; } }
      if (matched) {
        setWelcomeRole(matched.role);
        setWelcomeName(matched.name);
      }
    } catch { /* fall through */ }
    const ok = await login(pin);
    setLoading(false);
    if (!ok) {
      setError(true);
      setPin("");
      setWelcomeRole(null);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative"
      style={{
        background: "linear-gradient(135deg, #0a2540 0%, #0c4a6e 40%, #0e7490 70%, #0891b2 100%)",
      }}
    >
      {/* Language toggle top-right */}
      <div className="absolute top-4 right-4 z-10">
        <LangToggle />
      </div>

      {/* Decorative blurred circles */}
      <div
        className="absolute top-[-80px] left-[-80px] w-80 h-80 rounded-full opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(circle, #22d3ee 0%, transparent 70%)" }}
      />
      <div
        className="absolute bottom-[-60px] right-[-60px] w-64 h-64 rounded-full opacity-15 pointer-events-none"
        style={{ background: "radial-gradient(circle, #0ea5e9 0%, transparent 70%)" }}
      />

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Card top accent bar */}
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #0891b2, #0e7490, #0c4a6e)" }} />

        <div className="px-8 pt-8 pb-8">
          {/* App icon */}
          <div className="flex justify-center mb-5">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg, #0891b2 0%, #0c4a6e 100%)" }}
            >
              {/* Medical cross icon */}
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="15" y="5" width="10" height="30" rx="3" fill="white" fillOpacity="0.95" />
                <rect x="5" y="15" width="30" height="10" rx="3" fill="white" fillOpacity="0.95" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-7">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">DivineLink</h1>
            <p className="text-sm text-gray-500 mt-1">Medical Clinic Management System</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username field */}
            <div>
              <label className="block text-xs font-bold text-gray-500 tracking-widest uppercase mb-1.5">
                {t("auth.username") || "Username"}
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition bg-gray-50"
                autoComplete="username"
              />
            </div>

            {/* PIN field */}
            <div>
              <label className="block text-xs font-bold text-gray-500 tracking-widest uppercase mb-1.5">
                {t("auth.pinLabel") || "PIN / Password"}
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(false); }}
                placeholder="••••"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 text-center text-xl tracking-[0.5em] placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition bg-gray-50"
                autoFocus
                autoComplete="current-password"
              />
            </div>

            {/* Role badge after successful PIN */}
            {welcomeRole && !error && (
              <div className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold ${ROLE_COLORS[welcomeRole] || "bg-gray-100 text-gray-700 border-gray-300"}`}>
                ✓ {welcomeName} — {welcomeRole.charAt(0).toUpperCase() + welcomeRole.slice(1)}
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-red-500 text-sm text-center font-medium">
                {t("auth.error")}
              </p>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={pin.length < 4 || loading}
              className="w-full py-3.5 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: pin.length >= 4 && !loading
                  ? "linear-gradient(135deg, #0891b2 0%, #0c4a6e 100%)"
                  : "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)",
                boxShadow: pin.length >= 4 && !loading ? "0 4px 16px rgba(8,145,178,0.4)" : "none",
              }}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {t("auth.login")}
                  <span className="text-lg">→</span>
                </>
              )}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
