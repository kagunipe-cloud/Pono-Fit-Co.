"use client";

import { useEffect, useState } from "react";

type PrData = { pr_reps: number | null; last_session_reps: number | null; last_session_date: string | null };

type LiftSetPrPercentProps = {
  exerciseId: number | null;
  exerciseName: string;
  weightStr: string;
  repsStr: string;
  /** Current workout id — excludes this workout from PR so % matches “vs your prior best at this weight”. */
  excludeWorkoutId: number | null;
  /** Increment when workout data is refetched (e.g. after saving sets). */
  invalidateKey: number;
  /** If false, only the percentage is shown (e.g. finished workout already shows 🍍 + PR copy from pr-badges). */
  showPineapple?: boolean;
};

/**
 * Shows reps at this weight as a % of your prior PR at that weight (same logic as /api/member/workouts/pr).
 * 🍍 when this set is a new PR at that weight (no prior reps, or more reps than prior best excluding this workout).
 */
export function LiftSetPrPercent({
  exerciseId,
  exerciseName,
  weightStr,
  repsStr,
  excludeWorkoutId,
  invalidateKey,
  showPineapple = true,
}: LiftSetPrPercentProps) {
  const [data, setData] = useState<PrData | null>(null);
  const [loading, setLoading] = useState(false);
  const weightNum = parseFloat(weightStr);
  const repsNum = parseInt(repsStr, 10);
  const valid =
    (exerciseId != null || exerciseName.trim().length > 0) &&
    !Number.isNaN(weightNum) &&
    weightNum > 0 &&
    !Number.isNaN(repsNum) &&
    repsNum > 0;

  useEffect(() => {
    if (!valid) {
      setData(null);
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ weight: String(weightNum) });
      if (excludeWorkoutId != null) params.set("exclude_workout_id", String(excludeWorkoutId));
      if (exerciseId != null) params.set("exercise_id", String(exerciseId));
      else params.set("exercise_name", exerciseName.trim());
      fetch(`/api/member/workouts/pr?${params}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [valid, exerciseId, exerciseName, weightNum, repsNum, excludeWorkoutId, invalidateKey]);

  if (!valid) return null;
  if (loading) {
    return <span className="text-xs text-stone-400 tabular-nums shrink-0">…</span>;
  }
  if (!data) return null;

  const pr = data.pr_reps;
  const isPr = pr == null ? repsNum > 0 : repsNum > pr;
  const pct = pr != null && pr > 0 ? Math.round((repsNum / pr) * 100) : 100;

  return (
    <span
      className="inline-flex items-center gap-1 text-xs shrink-0 tabular-nums"
      title={pr != null && pr > 0 ? `Prior best at this weight: ${pr} reps` : "First reps logged at this weight"}
    >
      {showPineapple && isPr && <span aria-hidden>🍍</span>}
      <span className={isPr ? "text-brand-700 font-semibold" : "text-stone-600"}>{pct}% of PR</span>
    </span>
  );
}
