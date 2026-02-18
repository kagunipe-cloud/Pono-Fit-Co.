"use client";

import { Suspense } from "react";
import ScheduleGrid from "@/components/ScheduleGrid";

/** Master schedule (admin): gray blocks show what they are (description); links to add recurring classes and PT. */
export default function MasterSchedulePage() {
  return (
    <Suspense fallback={<div className="p-8 text-stone-500">Loading schedule…</div>}>
      <ScheduleGrid variant="master" />
    </Suspense>
  );
}
