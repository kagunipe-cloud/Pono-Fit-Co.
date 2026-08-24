"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { InStoreMarketingSlide } from "@/lib/in-store-marketing";

const ROTATE_MS = 30_000;
const REFRESH_MS = 5 * 60_000;

type SlidesResponse = { slides: InStoreMarketingSlide[] };

export default function InStoreMarketingTVDisplay() {
  const searchParams = useSearchParams();
  const manualPage = searchParams.get("page");
  const pauseRotation = manualPage !== null;
  const [slides, setSlides] = useState<InStoreMarketingSlide[]>([]);
  const [pageIndex, setPageIndex] = useState(0);

  const loadSlides = useCallback(async () => {
    try {
      const res = await fetch("/api/in-store-marketing/slides", { cache: "no-store" });
      const data = (await res.json()) as SlidesResponse;
      if (res.ok && Array.isArray(data.slides) && data.slides.length > 0) {
        setSlides(data.slides);
      }
    } catch {
      /* keep last good slides */
    }
  }, []);

  useEffect(() => {
    void loadSlides();
    const refresh = window.setInterval(() => void loadSlides(), REFRESH_MS);
    return () => window.clearInterval(refresh);
  }, [loadSlides]);

  useEffect(() => {
    const n = Number(manualPage);
    if (n >= 1 && n <= slides.length) setPageIndex(n - 1);
  }, [manualPage, slides.length]);

  useEffect(() => {
    if (slides.length === 0) return;
    setPageIndex((prev) => Math.min(prev, slides.length - 1));
  }, [slides.length]);

  useEffect(() => {
    if (pauseRotation || slides.length === 0) return;
    const timer = window.setInterval(() => {
      setPageIndex((prev) => (prev + 1) % slides.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [pauseRotation, slides.length]);

  const slide = useMemo(() => slides[pageIndex] ?? slides[0], [slides, pageIndex]);

  if (!slide) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-black text-[#9ef6b2]">
        Loading…
      </main>
    );
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={slide.id}
        src={slide.src}
        alt={slide.title}
        className="absolute inset-0 h-full w-full object-contain"
      />
      <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex justify-center gap-3">
        {slides.map((s, i) => (
          <span
            key={s.id}
            className={`h-3 rounded-full transition-all ${i === pageIndex ? "w-12 bg-[#9ef6b2]" : "w-3 bg-white/35"}`}
            aria-hidden
          />
        ))}
      </div>
    </main>
  );
}
