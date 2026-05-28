"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type WeeklyGoalsData = {
  workout_days_per_week: number | null;
  macro_goals_set: boolean;
  personal: {
    week_start: string;
    pr_exercise_id: number | null;
    pr_exercise_name: string | null;
    pr_weight_lbs: number | null;
    pr_reps: number | null;
    weigh_target_lbs: number | null;
    weigh_direction: "at_or_below" | "at_or_above" | null;
    pr_hit: boolean;
    weigh_hit: boolean;
    pr_percent: number | null;
    weigh_percent: number | null;
    pr_baseline_lbs: number | null;
    weigh_baseline_lbs: number | null;
    personal_hit: number;
    personal_target: number;
    personal_percent: number | null;
  };
};

type LiftOption = { id: number; name: string };

export default function WeeklyGoalsEditor() {
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liftOptions, setLiftOptions] = useState<LiftOption[]>([]);
  const [liftSearch, setLiftSearch] = useState("");
  const [prExerciseId, setPrExerciseId] = useState("");
  const [prWeight, setPrWeight] = useState("");
  const [prReps, setPrReps] = useState("");
  const [weighTarget, setWeighTarget] = useState("");
  const [weighDirection, setWeighDirection] = useState<"at_or_below" | "at_or_above" | "">("");

  useEffect(() => {
    setLoading(true);
    fetch("/api/member/weekly-goals")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: WeeklyGoalsData | null) => {
        if (!json?.personal) {
          setWeeklyGoals(null);
          return;
        }
        setWeeklyGoals(json);
        const p = json.personal;
        setPrExerciseId(p.pr_exercise_id != null ? String(p.pr_exercise_id) : "");
        setPrWeight(p.pr_weight_lbs != null ? String(p.pr_weight_lbs) : "");
        setPrReps(p.pr_reps != null ? String(p.pr_reps) : "");
        setWeighTarget(p.weigh_target_lbs != null ? String(p.weigh_target_lbs) : "");
        setWeighDirection(p.weigh_direction ?? "");
        if (p.pr_exercise_name && p.pr_exercise_id != null) {
          setLiftSearch(p.pr_exercise_name);
        }
      })
      .catch(() => setWeeklyGoals(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/member/exercises/frequent?type=lift&limit=25")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { id?: number; name?: string }[]) => {
        const opts = (Array.isArray(rows) ? rows : [])
          .filter((r) => r.id != null && r.name)
          .map((r) => ({ id: Number(r.id), name: String(r.name) }));
        setLiftOptions(opts);
      })
      .catch(() => setLiftOptions([]));
  }, []);

  useEffect(() => {
    const q = liftSearch.trim();
    if (q.length < 2) return;
    const t = window.setTimeout(() => {
      fetch(`/api/exercises?q=${encodeURIComponent(q)}&type=lift&boost_member=1`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: { id?: number; name?: string }[]) => {
          const opts = (Array.isArray(rows) ? rows : [])
            .filter((r) => r.id != null && r.name)
            .map((r) => ({ id: Number(r.id), name: String(r.name) }));
          if (opts.length > 0) setLiftOptions(opts);
        })
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(t);
  }, [liftSearch]);

  async function savePersonalWeeklyGoals(clearPr?: boolean, clearWeigh?: boolean) {
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (clearPr) {
        body.clear_pr = true;
      } else if (prExerciseId || prWeight || prReps) {
        body.pr_exercise_id = prExerciseId ? parseInt(prExerciseId, 10) : null;
        body.pr_weight_lbs = prWeight ? parseFloat(prWeight) : null;
        body.pr_reps = prReps ? parseInt(prReps, 10) : null;
      }
      if (clearWeigh) {
        body.clear_weigh = true;
      } else if (weighTarget || weighDirection) {
        body.weigh_target_lbs = weighTarget ? parseFloat(weighTarget) : null;
        body.weigh_direction = weighDirection || null;
      }
      const res = await fetch("/api/member/weekly-goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not save personal goals");
        return;
      }
      if (json.personal && weeklyGoals) {
        setWeeklyGoals({ ...weeklyGoals, personal: json.personal });
      }
    } catch {
      setError("Could not save personal goals");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-5 rounded-xl border-2 border-brand-200 bg-gradient-to-br from-brand-50 to-white shadow-sm">
      <h2 className="text-lg font-bold text-stone-800 mb-1">Set weekly goals</h2>
      <p className="text-sm text-stone-600 mb-4">
        These feed The Board. Workouts and macros use your existing pages; personal goals are set here for this week
        {weeklyGoals?.personal.week_start ? ` (Mon ${weeklyGoals.personal.week_start})` : ""}.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 mb-5">
        <Link
          href="/member/workouts"
          className="block p-4 rounded-lg border border-stone-200 bg-white hover:border-brand-300 transition-colors"
        >
          <h3 className="font-semibold text-stone-800">Workouts</h3>
          <p className="text-sm text-stone-600 mt-1">
            {weeklyGoals?.workout_days_per_week
              ? `Goal: ${weeklyGoals.workout_days_per_week} day${weeklyGoals.workout_days_per_week === 1 ? "" : "s"} / week`
              : "Set how many days/week you want to log workouts"}
          </p>
          <span className="text-sm text-brand-700 font-medium mt-2 inline-block">Open My Workouts →</span>
        </Link>
        <Link
          href="/member/macros"
          className="block p-4 rounded-lg border border-stone-200 bg-white hover:border-brand-300 transition-colors"
        >
          <h3 className="font-semibold text-stone-800">Macros</h3>
          <p className="text-sm text-stone-600 mt-1">
            {weeklyGoals?.macro_goals_set ? "Daily macro goals are set" : "Set daily calorie + macro targets"}
          </p>
          <span className="text-sm text-brand-700 font-medium mt-2 inline-block">Open My Macros →</span>
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-stone-500">Loading personal goals…</p>
      ) : (
        <div className="space-y-4 border-t border-stone-200 pt-4">
          <h3 className="font-semibold text-stone-800">Personal goals (this week)</h3>
          {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="p-4 rounded-lg border border-stone-200 bg-white">
            <p className="text-sm font-medium text-stone-700 mb-2">Lift PR goal</p>
            <p className="text-xs text-stone-500 mb-3">
              Progress is measured from your prior best at this rep count toward your weekly target weight. Hitting 50% of the way there scores 50% on The Board.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                list="weekly-lift-options"
                value={liftSearch}
                onChange={(e) => {
                  setLiftSearch(e.target.value);
                  const match = liftOptions.find((o) => o.name.toLowerCase() === e.target.value.trim().toLowerCase());
                  setPrExerciseId(match ? String(match.id) : "");
                }}
                placeholder="Search lift (e.g. Rack Pulls)"
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm sm:col-span-2"
              />
              <datalist id="weekly-lift-options">
                {liftOptions.map((o) => (
                  <option key={o.id} value={o.name} />
                ))}
              </datalist>
              <input
                type="number"
                min={1}
                step={1}
                value={prWeight}
                onChange={(e) => setPrWeight(e.target.value)}
                placeholder="Weight (lbs)"
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                min={1}
                step={1}
                value={prReps}
                onChange={(e) => setPrReps(e.target.value)}
                placeholder="Reps"
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void savePersonalWeeklyGoals()}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save lift goal"}
              </button>
              {(weeklyGoals?.personal.pr_exercise_id || prExerciseId) && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setPrExerciseId("");
                    setPrWeight("");
                    setPrReps("");
                    setLiftSearch("");
                    void savePersonalWeeklyGoals(true, false);
                  }}
                  className="px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                >
                  Clear lift goal
                </button>
              )}
            </div>
            {weeklyGoals?.personal.pr_exercise_id && weeklyGoals.personal.pr_weight_lbs != null && (
              <p className={`text-xs mt-2 font-medium ${weeklyGoals.personal.pr_hit ? "text-emerald-700" : "text-stone-500"}`}>
                Lift PR:{" "}
                {weeklyGoals.personal.pr_hit
                  ? "Goal hit this week ✓"
                  : weeklyGoals.personal.pr_percent != null
                    ? `${weeklyGoals.personal.pr_percent}% toward ${weeklyGoals.personal.pr_weight_lbs} lbs${
                        weeklyGoals.personal.pr_baseline_lbs != null
                          ? ` (from ${weeklyGoals.personal.pr_baseline_lbs} lbs)`
                          : ""
                      }`
                    : "No attempts yet this week"}
              </p>
            )}
          </div>

          <div className="p-4 rounded-lg border border-stone-200 bg-white">
            <p className="text-sm font-medium text-stone-700 mb-2">Weekly weigh-in goal</p>
            <p className="text-xs text-stone-500 mb-3">
              Separate from your long-term weight goal in Macros. Progress uses your most recent journal weigh-in before this week, or your first log this week if that&apos;s all you have.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="number"
                min={1}
                step={0.1}
                value={weighTarget}
                onChange={(e) => setWeighTarget(e.target.value)}
                placeholder="Target weight (lbs)"
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
              <select
                value={weighDirection}
                onChange={(e) => setWeighDirection(e.target.value as "at_or_below" | "at_or_above" | "")}
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">At or below / above…</option>
                <option value="at_or_below">Weigh in at or below target</option>
                <option value="at_or_above">Weigh in at or above target</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void savePersonalWeeklyGoals()}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save weigh-in goal"}
              </button>
              {(weeklyGoals?.personal.weigh_target_lbs || weighTarget) && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setWeighTarget("");
                    setWeighDirection("");
                    void savePersonalWeeklyGoals(false, true);
                  }}
                  className="px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                >
                  Clear weigh-in goal
                </button>
              )}
            </div>
            {weeklyGoals?.personal.weigh_target_lbs && weeklyGoals.personal.weigh_direction && (
              <p className={`text-xs mt-2 font-medium ${weeklyGoals.personal.weigh_hit ? "text-emerald-700" : "text-stone-500"}`}>
                Weigh-in:{" "}
                {weeklyGoals.personal.weigh_hit
                  ? "Goal hit this week ✓"
                  : weeklyGoals.personal.weigh_baseline_lbs == null
                    ? "Log a weigh-in in your journal to start tracking progress"
                    : weeklyGoals.personal.weigh_percent != null
                      ? `${weeklyGoals.personal.weigh_percent}% toward ${weeklyGoals.personal.weigh_target_lbs} lbs (from ${weeklyGoals.personal.weigh_baseline_lbs} lbs)`
                      : "No weigh-in logged this week yet"}
              </p>
            )}
          </div>

          {weeklyGoals?.personal.personal_percent != null ? (
            <p className="text-sm text-stone-700">
              Personal goal score:{" "}
              <span className="font-semibold">{weeklyGoals.personal.personal_percent}%</span>
              {weeklyGoals.personal.pr_percent != null && weeklyGoals.personal.weigh_percent != null
                ? ` (lift ${weeklyGoals.personal.pr_percent}%, weigh-in ${weeklyGoals.personal.weigh_percent}%)`
                : null}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
