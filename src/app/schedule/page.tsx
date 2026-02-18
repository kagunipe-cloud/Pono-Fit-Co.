"use client";

import ScheduleGrid from "@/components/ScheduleGrid";

/** Member schedule: same grid but gray blocks (unavailable / booked) are not labeled. */
export default function SchedulePage() {
  return <ScheduleGrid variant="member" />;
}
