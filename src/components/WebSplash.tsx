"use client";

import { useLayoutEffect, useState } from "react";
import { BRAND } from "@/lib/branding";
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
      {/* eslint-disable-next-line @next/next/no-img-element -- small static asset, no layout shift */}
      <img src="/Lei_Logos.png" alt="" className="h-20 w-auto sm:h-24 drop-shadow-md" />
      <p className="text-lg sm:text-xl font-semibold text-stone-800 tracking-tight">{BRAND.shortName}</p>
    </div>
  );
}
