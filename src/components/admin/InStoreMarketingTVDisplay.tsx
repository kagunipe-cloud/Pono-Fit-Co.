"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IN_STORE_MARKETING_SLIDES } from "@/lib/in-store-marketing";

const ROTATE_MS = 30_000;

export default function InStoreMarketingTVDisplay() {
  const searchParams = useSearchParams();
  const manualPage = searchParams.get("page");
  const pauseRotation = manualPage !== null;
  const [pageIndex, setPageIndex] = useState(() => {
    const n = Number(manualPage);
    if (n >= 1 && n <= IN_STORE_MARKETING_SLIDES.length) return n - 1;
    return 0;
  });

  useEffect(() => {
    const n = Number(manualPage);
    if (n >= 1 && n <= IN_STORE_MARKETING_SLIDES.length) {
      setPageIndex(n - 1);
    }
  }, [manualPage]);

  useEffect(() => {
    if (pauseRotation) return;
    const timer = window.setInterval(() => {
      setPageIndex((prev) => (prev + 1) % IN_STORE_MARKETING_SLIDES.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [pauseRotation]);

  const slide = useMemo(
    () => IN_STORE_MARKETING_SLIDES[pageIndex] ?? IN_STORE_MARKETING_SLIDES[0]!,
    [pageIndex]
  );

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      <Image
        key={slide.id}
        src={slide.src}
        alt={slide.title}
        fill
        priority
        unoptimized
        className="object-contain"
        sizes="100vw"
      />
      <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex justify-center gap-3">
        {IN_STORE_MARKETING_SLIDES.map((s, i) => (
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
