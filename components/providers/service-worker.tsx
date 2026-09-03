"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that backs push notifications and the offline
 * shell. Registration is skipped in development, where an active worker
 * intercepting requests makes hot reload behave unpredictably.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("[sw] registration failed", error);
      });
    };

    // Wait for load so registration never competes with the first paint.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
