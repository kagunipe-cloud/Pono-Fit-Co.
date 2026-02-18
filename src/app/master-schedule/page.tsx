"use client";

import ScheduleGrid from "@/components/ScheduleGrid";

/** Master schedule (admin): gray blocks show what they are (description); links to add recurring classes and PT. */
export default function MasterSchedulePage() {
  return <ScheduleGrid variant="master" />;
}
