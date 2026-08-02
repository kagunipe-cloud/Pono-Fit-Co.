"use client";

import { isSameDayAppointment, SAME_DAY_SCHEDULING_MESSAGE } from "@/lib/same-day-scheduling";
import { useAppTimezone } from "@/lib/settings-context";

type SameDaySchedulingNoticeProps = {
  dateYmd: string | null | undefined;
  className?: string;
};

export function SameDaySchedulingNotice({ dateYmd, className = "" }: SameDaySchedulingNoticeProps) {
  const tz = useAppTimezone();
  if (!isSameDayAppointment(dateYmd, tz)) return null;
  return (
    <p
      role="note"
      className={`text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed ${className}`.trim()}
    >
      {SAME_DAY_SCHEDULING_MESSAGE}
    </p>
  );
}
