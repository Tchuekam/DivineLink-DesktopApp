import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * "Install App" button. On Android/desktop Chrome it triggers the native
 * beforeinstallprompt. On iOS Safari (no event), it shows manual instructions.
 * The button hides itself once the app is already installed (standalone mode).
 */
export function InstallPWAButton() {
  const { lang } = useLang();
  const [deferred, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as any).standalone === true;
    setInstalled(standalone);
    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const handleClick = async () => {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch { /* ignore */ }
      setDeferred(null);
    }
  };

  // iOS: show popover with instructions
  if (isIOS && !deferred) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" title={lang === "fr" ? "Installer l'app" : "Install app"}>
            <Download className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 text-sm" align="end">
          {lang === "fr"
            ? "Safari → icône Partager → Sur l'écran d'accueil"
            : "Safari → Share icon → Add to Home Screen"}
        </PopoverContent>
      </Popover>
    );
  }

  // Hide entirely when no install prompt available (e.g. Firefox desktop, or already dismissed)
  if (!deferred) return null;

  return (
    <Button variant="ghost" size="icon" onClick={handleClick} title={lang === "fr" ? "Installer l'app" : "Install app"}>
      <Download className="w-4 h-4" />
    </Button>
  );
}
