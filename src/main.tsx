import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { checkAndHandleWipeUrl } from "@/lib/wipe";

(async () => {
  const wiped = await checkAndHandleWipeUrl();
  if (wiped) return;
  createRoot(document.getElementById("root")!).render(<App />);
})();

// Register PWA service worker for ALL builds (per offline-first spec),
// except inside Lovable preview iframes which would otherwise serve stale shells.
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const host = window.location.hostname;
const isPreviewHost =
  host.includes("lovableproject.com") ||
  host.includes("id-preview--");

if ("serviceWorker" in navigator) {
  if (!isInIframe && !isPreviewHost) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        // When a new SW takes over, reload the page so fresh assets are shown immediately.
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "activated") {
              window.location.reload();
            }
          });
        });
      }).catch(() => {});
    });
  } else {
    // Defensive: clear any previously registered SW in dev/preview to avoid stale caches.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    }).catch(() => {});
  }
}
