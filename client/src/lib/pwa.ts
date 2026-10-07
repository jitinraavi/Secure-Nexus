/**
 * Service Worker Registration and PWA Lifecycle
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;
          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.log("[Groundwork PWA] New update available.");
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[Groundwork PWA] Service worker registration failed:", err);
      });
  });
}
