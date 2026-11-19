"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TRAINING_PHASES, type TrainingPhase } from "@/lib/training-programs";

export type ProgramWorkoutRow = {
  id: number;
  day_index: number;
  sort_order: number;
  name: string;
  training_phase: TrainingPhase;
  exercises?: unknown[];
};

type Props = {
  workouts: ProgramWorkoutRow[];
  maxDay?: number;
  onMove: (workoutId: number, newDayIndex: number) => void | Promise<void>;
  editHref?: (workoutId: number) => string;
};

export default function ProgramCalendarBoard({ workouts, maxDay = 28, onMove, editHref }: Props) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overDay, setOverDay] = useState<number | null>(null);

  const days = useMemo(() => {
    const maxFromData = workouts.reduce((m, w) => Math.max(m, w.day_index), 0);
    const n = Math.max(maxFromData, 7, Math.min(maxDay, 42));
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [workouts, maxDay]);

  const byDay = useMemo(() => {
    const map = new Map<number, ProgramWorkoutRow[]>();
    for (const d of days) map.set(d, []);
    for (const w of workouts) {
      const list = map.get(w.day_index) ?? [];
      list.push(w);
      map.set(w.day_index, list);
    }
    for (const [d, list] of map) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      map.set(d, list);
    }
    return map;
  }, [days, workouts]);

  async function dropOnDay(day: number) {
    if (dragId == null) return;
    await onMove(dragId, day);
    setDragId(null);
    setOverDay(null);
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-2 min-w-max">
        {days.map((day) => (
          <div
            key={day}
            className={`w-36 shrink-0 rounded-lg border bg-stone-50 p-2 min-h-[120px] transition-colors ${
              overDay === day ? "border-brand-500 bg-brand-50" : "border-stone-200"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setOverDay(day);
            }}
            onDragLeave={() => setOverDay((d) => (d === day ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              void dropOnDay(day);
            }}
          >
            <p className="text-xs font-semibold text-stone-500 mb-2">Day {day}</p>
            <ul className="space-y-1.5">
              {(byDay.get(day) ?? []).map((w) => (
                <li
                  key={w.id}
                  draggable
                  onDragStart={() => setDragId(w.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverDay(null);
                  }}
                  className="cursor-grab active:cursor-grabbing rounded border border-white bg-white p-2 text-xs shadow-sm"
                >
                  <p className="font-medium text-stone-800 leading-tight">{w.name}</p>
                  <p className="text-[10px] text-stone-500 mt-0.5">{w.training_phase}</p>
                  {editHref && (
                    <Link
                      href={editHref(w.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-brand-700 font-medium hover:underline mt-1 inline-block"
                    >
                      Edit workout
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-stone-500 mt-2">Drag workouts between days. Phases: {TRAINING_PHASES.join(", ")}.</p>
    </div>
  );
}