"use client";

import { useEffect, useState } from "react";
import { formatDateForDisplay } from "@/lib/app-timezone";

type Period = "week" | "month";

type VisitDaysPayload = {
  timezone: string;
  today: string;
  week: { start: string; end: string; visit_days: number };
  month: { start: string; end: string; visit_days: number };
} | null;

function daysInRangeInclusive(start: string, end: string): number {
  const startMs = Date.parse(`${start}T12:00:00Z`);
  const endMs = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 1;
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

export default function MemberVisitDays() {
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<VisitDaysPayload>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/member/visit-days")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const bucket = period === "week" ? data?.week : data?.month;
  const visitDays = bucket?.visit_days ?? 0;
  const rangeStart = bucket?.start ?? "";
  const rangeEnd = bucket?.end ?? "";
  const rangeDays = rangeStart && rangeEnd ? daysInRangeInclusive(rangeStart, rangeEnd) : period === "week" ? 7 : 1;
  const barPct = rangeDays > 0 ? Math.min(100, (visitDays / rangeDays) * 100) : 0;

  return (
    <div className="mb-6 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-medium text-stone-500">Gym visits</h2>
        <div
          className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-xs font-medium"
          role="tablist"
          aria-label="Visit period"
        >
          <button
            type="button"
            role="tab"
            aria-selected={period === "week"}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              period === "week" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
            }`}
            onClick={() => setPeriod("week")}
          >
            Week
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={period === "month"}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              period === "month" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
            }`}
            onClick={() => setPeriod("month")}
          >
            Month
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : !data ? (
        <p className="text-sm text-stone-500">Couldn&apos;t load visit count.</p>
      ) : (
        <>
          <p className="text-3xl font-bold text-stone-800 tabular-nums">
            {visitDays}
            <span className="text-base font-normal text-stone-500 ml-2">
              {visitDays === 1 ? "day" : "days"} checked in
            </span>
          </p>
          <p className="text-xs text-stone-500 mt-1">
            {formatDateForDisplay(rangeStart)} – {formatDateForDisplay(rangeEnd)}
            <span className="text-stone-400"> · unique door check-in days</span>
          </p>
          <div className="mt-3 h-2 w-full rounded-full bg-stone-100 overflow-hidden" aria-hidden>
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out"
              style={{ width: `${barPct}%` }}
            />
          </div>
          <p className="text-xs text-stone-400 mt-1">
            {visitDays} of {rangeDays} {period === "week" ? "days this week" : "days this month"}
          </p>
        </>
      )}
    </div>
  );
}
