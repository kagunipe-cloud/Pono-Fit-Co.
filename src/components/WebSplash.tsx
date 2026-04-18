"use client";

import { useLayoutEffect, useState } from "react";
import { isNativeAppShell } from "@/lib/native-app-client";

const SESSION_KEY = "ponofit_web_splash_v1";

/**
 * Light “for fun” splash on first load per browser tab (desktop + installed Android PWA).
 * Skips native Capacitor shell (has its own splash) and users who prefer reduced motion.
 */
export default function WebSplash() {
  const [phase, setPhase] = useState<"off" | "on" | "fade">("off");

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (isNativeAppShell()) return;
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        sessionStorage.setItem(SESSION_KEY, "1");
        return;
      }
    } catch {
      /* ignore */
    }
    if (sessionStorage.getItem(SESSION_KEY)) return;

    setPhase("on");
    const fade = window.setTimeout(() => setPhase("fade"), 900);
    const done = window.setTimeout(() => {
      sessionStorage.setItem(SESSION_KEY, "1");
      setPhase("off");
    }, 1400);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, []);

  if (phase === "off") return null;

  return (
    <div
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-gradient-to-br from-brand-50 via-white to-brand-200 pointer-events-none transition-opacity duration-500 ease-out ${
        phase === "fade" ? "opacity-0" : "opacity-100"
      }`}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static splash art from public/ */}
      <img
        src="/pwa-splash.png"
        alt=""
        className="max-h-[min(55vh,640px)] w-auto max-w-[min(92vw,520px)] object-contain drop-shadow-md"
      />
    </div>
  );
}
