"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const BYPASS_PATHS = [
  "/sign-waiver-required",
  "/sign-waiver",
  "/accept-privacy-terms",
  "/privacy",
  "/terms",
  "/login",
  "/set-password",
];

const CACHE_KEY = "waiver_gate_ok";

function isCacheValid(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

function setCacheValid(): void {
  try {
    sessionStorage.setItem(CACHE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearWaiverGateCache(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function WaiverGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (BYPASS_PATHS.some((p) => pathname === p || pathname?.startsWith(p + "/"))) {
      setChecked(true);
      return;
    }
    if (isCacheValid()) {
      setChecked(true);
      return;
    }
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) {
          setChecked(true);
          return;
        }
        if (!data.privacy_terms_accepted) {
          router.replace("/accept-privacy-terms");
          return;
        }
        if (data.needs_waiver) {
          router.replace("/sign-waiver-required");
          return;
        }
        const waiverSigned = !!(data.waiver_signed_at ?? "").trim();
        if (waiverSigned) setCacheValid();
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [pathname, router]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }
  return <>{children}</>;
}
