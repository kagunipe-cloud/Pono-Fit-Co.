"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const MIN_MS_BETWEEN_SAME_PATH = 30_000; // 30s

export function UsageTracker() {
  const pathname = usePathname();
  const lastSent = useRef<{ path: string; at: number }>({ path: "", at: 0 });

  useEffect(() => {
    if (!pathname?.startsWith("/member")) return;
    const now = Date.now();
    const prev = lastSent.current;
    if (prev.path === pathname && now - prev.at < MIN_MS_BETWEEN_SAME_PATH) return;
    lastSent.current = { path: pathname, at: now };
    fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "page_view", path: pathname }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
