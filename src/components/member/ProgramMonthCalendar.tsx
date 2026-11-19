"use client";

import { useMemo, useState } from "react";
import { formatDateForDisplay } from "@/lib/app-timezone";
import { daysInMonth } from "@/lib/program-schedule";

export type ScheduledWorkout = {
  id: number;
  name: string;
  training_phase: string;
  scheduled_date: string;
  exercise_count: number;
  sort_order: number;
};

type Props = {
  todayYmd: string;
  timeZone: string;
  workouts: ScheduledWorkout[];
  startingId: number | null;
  onStart: (programWorkoutId: number) => void;
};

function parseMonthKey(key: string): { y: number; m: number } {
  const [ys, ms] = key.split("-");
  return { y: parseInt(ys!, 10), m: parseInt(ms!, 10) - 1 };
}

function shiftMonth(key: string, delta: number): string {
  const { y, m } = parseMonthKey(key);
  const d = new Date(Date.UTC(y, m + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function ProgramMonthCalendar({ todayYmd, timeZone, workouts, startingId, onStart }: Props) {
  const [monthKey, setMonthKey] = useState(todayYmd.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(todayYmd);

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduledWorkout[]>();
    for (const w of workouts) {
      const d = w.scheduled_date;
      const list = map.get(d) ?? [];
      list.push(w);
      map.set(d, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    }
    return map;
  }, [workouts]);

  const todayWorkouts = byDate.get(todayYmd) ?? [];

  const grid = useMemo(() => {
    const { y, m } = parseMonthKey(monthKey);
    const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const nDays = daysInMonth(y, m);
    const cells: { date: string | null; day: number | null }[] = [];
    for (let i = 0; i < firstDow; i++) cells.push({ date: null, day: null });
    for (let d = 1; d <= nDays; d++) {
      const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date, day: d });
    }
    return cells;
  }, [monthKey]);

  const selectedList = byDate.get(selectedDate) ?? [];
  const monthLabel = useMemo(() => {
    try {
      return new Date(`${monthKey}-01T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone,
      });
    } catch {
      return monthKey;
    }
  }, [monthKey, timeZone]);

  return (
    <div>
      {todayWorkouts.length > 0 && (
        <div className="mb-6 rounded-xl border-2 border-brand-300 bg-brand-50/80 p-4">
          <p className="text-sm font-semibold text-brand-900">Today&apos;s workout</p>
          <p className="text-xs text-brand-800/80 mt-0.5">{formatDateForDisplay(todayYmd, timeZone)}</p>
          <ul className="mt-3 space-y-2">
            {todayWorkouts.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-stone-900">{w.name}</p>
                  <p className="text-xs text-stone-600">
                    {w.training_phase}
                    {w.exercise_count > 0 ? ` · ${w.exercise_count} exercises` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={startingId === w.id}
                  onClick={() => onStart(w.id)}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                >
                  {startingId === w.id ? "Starting…" : todayWorkouts.length === 1 ? "Start today\u2019s workout" : "Start"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-3">
        <button
          type="button"
          onClick={() => setMonthKey((k) => shiftMonth(k, -1))}
          className="px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 rounded"
          aria-label="Previous month"
        >
          ←
        </button>
        <p className="text-sm font-semibold text-stone-800">{monthLabel.trim() || monthKey}</p>
        <button
          type="button"
          onClick={() => setMonthKey((k) => shiftMonth(k, 1))}
          className="px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 rounded"
          aria-label="Next month"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-stone-500 mb-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell, i) => {
          if (!cell.date) return <div key={`e-${i}`} className="aspect-square" />;
          const scheduled = byDate.get(cell.date) ?? [];
          const isToday = cell.date === todayYmd;
          const isSelected = cell.date === selectedDate;
          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => cell.date && setSelectedDate(cell.date)}
              className={`aspect-square rounded-lg border text-xs flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isToday
                  ? "border-brand-500 bg-brand-100 font-bold text-brand-900 ring-2 ring-brand-400/60"
                  : isSelected
                    ? "border-stone-400 bg-stone-100"
                    : scheduled.length
                      ? "border-violet-200 bg-violet-50/80 hover:bg-violet-100"
                      : "border-stone-100 bg-white hover:bg-stone-50 text-stone-600"
              }`}
            >
              <span>{cell.day}</span>
              {scheduled.length > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500" title={`${scheduled.length} workout(s)`} />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-4 min-h-[80px]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
          {formatDateForDisplay(selectedDate, timeZone)}
        </p>
        {selectedList.length === 0 ? (
          <p className="text-sm text-stone-500 mt-2">No workout scheduled — rest or catch up on another day.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {selectedList.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-stone-800">{w.name}</p>
                  <p className="text-xs text-stone-500">{w.training_phase}</p>
                </div>
                <button
                  type="button"
                  disabled={startingId === w.id}
                  onClick={() => onStart(w.id)}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {startingId === w.id ? "Starting…" : "Start workout"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}