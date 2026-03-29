"use client";

import { useEffect } from "react";

/**
 * Registers the app shell service worker in production so Chrome/Edge/Android
 * can offer the native "Add to Home screen" / install prompt (beforeinstallprompt).
 * Skipped in `next dev` to avoid interfering with Fast Refresh.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const { protocol, hostname } = window.location;
    const secure =
      protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
    if (!secure) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* non-fatal */
    });
  }, []);

  return null;
}
