"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export function WaiverGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (pathname === "/sign-waiver-required" || pathname === "/sign-waiver" || pathname === "/privacy" || pathname === "/terms") {
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
        const waiverSigned = !!(data.waiver_signed_at ?? "").trim();
        if (!waiverSigned) {
          router.replace("/sign-waiver-required");
          return;
        }
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
