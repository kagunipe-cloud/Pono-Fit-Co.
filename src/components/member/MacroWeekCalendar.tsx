"use client";

import Link from "next/link";
import { addDaysToDateStr, formatDateForDisplay, formatWeekdayShortInAppTz } from "@/lib/app-timezone";

export type MacroDaySummary = {
  cal: number;
  p: number;
  f: number;
  c: number;
  board?: {
    hit: boolean;
    countable: boolean;
    finished: boolean;
    goals_configured: boolean;
  };
};

type MacroWeekCalendarProps = {
  weekStart: string;
  today: string;
  tz: string;
  summary: Record<string, MacroDaySummary> | null;
  loading?: boolean;
  isCurrentWeek?: boolean;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
};

function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i));
}

export default function MacroWeekCalendar({
  weekStart,
  today,
  tz,
  summary,
  loading = false,
  isCurrentWeek = true,
  onPrevWeek,
  onNextWeek,
}: MacroWeekCalendarProps) {
  const dates = weekDates(weekStart);
  const weekEnd = dates[6]!;

  return (
    <div className="mb-8 p-4 rounded-xl border-2 border-brand-200 bg-gradient-to-br from-brand-50/80 to-white shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={onPrevWeek}
          disabled={!onPrevWeek}
          aria-label="Previous week"
          className="shrink-0 flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          ←
        </button>
        <div className="flex-1 min-w-0 text-center">
          <h2 className="font-semibold text-stone-800">{isCurrentWeek ? "This week" : "Week"}</h2>
          <p className="text-xs text-stone-500">
            {formatDateForDisplay(weekStart, tz)} – {formatDateForDisplay(weekEnd, tz)}
          </p>
        </div>
        <button
          type="button"
          onClick={onNextWeek}
          disabled={!onNextWeek}
          aria-label="Next week"
          className="shrink-0 flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          →
        </button>
      </div>
      <p className="text-xs text-stone-500 mb-4">
        Tap a day to open your journal. Hit your macros (within 15%) and earn a shaka on The Board.
      </p>

      {loading ? (
        <p className="text-sm text-stone-400 py-6 text-center">Loading week…</p>
      ) : (
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {dates.map((date) => {
            const weekday = formatWeekdayShortInAppTz(date, tz);
            const dayNum = date.slice(8, 10).replace(/^0/, "");
            const isToday = date === today;
            const isFuture = date > today;
            const day = summary?.[date];
            const board = day?.board;
            const hit = board?.hit === true;
            const hasLog = (day?.cal ?? 0) > 0;
            const goalsSet = board?.goals_configured === true;

            const cellClass = [
              "flex flex-col items-center justify-center rounded-xl border min-h-[4.5rem] sm:min-h-[5.25rem] p-1.5 transition-colors",
              isToday ? "border-brand-500 bg-white ring-2 ring-brand-200" : "border-stone-200 bg-white",
              isFuture && !isToday ? "border-dashed border-brand-200/80 hover:border-brand-400 hover:bg-brand-50/60" : "hover:border-brand-300 hover:bg-brand-50/50",
            ].join(" ");

            const inner = (
              <>
                <span className="text-[0.65rem] sm:text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {weekday}
                </span>
                <span className={`text-sm sm:text-base font-bold ${isToday ? "text-brand-800" : "text-stone-800"}`}>
                  {dayNum}
                </span>
                <div className="mt-1 h-8 sm:h-9 flex items-center justify-center">
                  {hit ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/shaka.svg" alt="Macros hit" className="h-7 w-7 sm:h-8 sm:w-8 object-contain" />
                  ) : isFuture ? (
                    hasLog ? (
                      <span className="text-[0.55rem] sm:text-[0.6rem] text-stone-500 text-center leading-tight px-0.5">
                        {Math.round(day!.cal).toLocaleString()} cal
                      </span>
                    ) : (
                      <span className="text-[0.55rem] sm:text-[0.6rem] text-brand-700 text-center leading-tight px-0.5 font-semibold">
                        Start planning!
                      </span>
                    )
                  ) : !goalsSet ? (
                    <span className="text-[0.55rem] sm:text-[0.6rem] text-stone-400 text-center leading-tight px-0.5">
                      Set goals
                    </span>
                  ) : isToday && !board?.countable ? (
                    <span className="text-[0.55rem] sm:text-[0.6rem] text-amber-700 text-center leading-tight px-0.5">
                      {hasLog ? "Finish log" : "Log food"}
                    </span>
                  ) : board?.countable && hasLog ? (
                    <span className="text-[0.55rem] sm:text-[0.6rem] text-stone-400 text-center leading-tight px-0.5">
                      {Math.round(day!.cal).toLocaleString()} cal
                    </span>
                  ) : (
                    <span className="text-[0.55rem] sm:text-[0.6rem] text-stone-400">—</span>
                  )}
                </div>
              </>
            );

            return (
              <Link key={date} href={`/member/macros/day/${date}`} className={cellClass} aria-label={`${weekday} ${date}`}>
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
