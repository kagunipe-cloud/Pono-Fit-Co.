"use client";

import { Suspense } from "react";
import ScheduleGrid from "@/components/ScheduleGrid";

/** Member schedule: same grid but gray blocks (unavailable / booked) are not labeled. */
export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="p-8 text-stone-500">Loading schedule…</div>}>
      <ScheduleGrid variant="member" />
    </Suspense>
  );
}
