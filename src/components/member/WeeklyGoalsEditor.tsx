"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type GoalMetric = { hit: number; target: number; percent: number | null };

type WeeklyGoalsData = {
  workouts_per_week: number | null;
  macro_goals_set: boolean;
  workouts?: GoalMetric;
  macros?: GoalMetric;
  personal: {
    week_start: string;
    pr_exercise_id: number | null;
    pr_exercise_name: string | null;
    pr_weight_lbs: number | null;
    pr_weight_at_reps: number | null;
    pr_reps_at_weight_lbs: number | null;
    pr_reps_target: number | null;
    weigh_target_lbs: number | null;
    weigh_direction: "at_or_below" | "at_or_above" | null;
    weight_pr_hit: boolean;
    reps_pr_hit: boolean;
    weigh_hit: boolean;
    weight_pr_percent: number | null;
    reps_pr_percent: number | null;
    weigh_percent: number | null;
    weight_pr_baseline_lbs: number | null;
    weight_pr_current_lbs: number | null;
    reps_pr_baseline: number | null;
    reps_pr_current: number | null;
    weigh_baseline_lbs: number | null;
    weigh_current_lbs: number | null;
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
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [liftOptions, setLiftOptions] = useState<LiftOption[]>([]);
  const [liftSearch, setLiftSearch] = useState("");
  const [prExerciseId, setPrExerciseId] = useState("");
  const [weightPrTarget, setWeightPrTarget] = useState("");
  const [weightPrReps, setWeightPrReps] = useState("");
  const [repsPrWeight, setRepsPrWeight] = useState("");
  const [repsPrTarget, setRepsPrTarget] = useState("");
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
        setWeightPrTarget(p.pr_weight_lbs != null ? String(p.pr_weight_lbs) : "");
        setWeightPrReps(p.pr_weight_at_reps != null ? String(p.pr_weight_at_reps) : "");
        setRepsPrWeight(p.pr_reps_at_weight_lbs != null ? String(p.pr_reps_at_weight_lbs) : "");
        setRepsPrTarget(p.pr_reps_target != null ? String(p.pr_reps_target) : "");
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

  async function refreshWeeklyGoals(): Promise<WeeklyGoalsData | null> {
    const res = await fetch("/api/member/weekly-goals");
    if (!res.ok) return null;
    const json = (await res.json()) as WeeklyGoalsData;
    if (!json?.personal) return null;
    setWeeklyGoals(json);
    const p = json.personal;
    setPrExerciseId(p.pr_exercise_id != null ? String(p.pr_exercise_id) : "");
    setWeightPrTarget(p.pr_weight_lbs != null ? String(p.pr_weight_lbs) : "");
    setWeightPrReps(p.pr_weight_at_reps != null ? String(p.pr_weight_at_reps) : "");
    setRepsPrWeight(p.pr_reps_at_weight_lbs != null ? String(p.pr_reps_at_weight_lbs) : "");
    setRepsPrTarget(p.pr_reps_target != null ? String(p.pr_reps_target) : "");
    setWeighTarget(p.weigh_target_lbs != null ? String(p.weigh_target_lbs) : "");
    setWeighDirection(p.weigh_direction ?? "");
    if (p.pr_exercise_name && p.pr_exercise_id != null) {
      setLiftSearch(p.pr_exercise_name);
    }
    return json;
  }

  async function patchPersonalGoals(body: Record<string, unknown>, successMessage: string) {
    setError(null);
    setSavedMessage(null);
    setSaving(true);
    try {
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
      await refreshWeeklyGoals();
      setSavedMessage(successMessage);
    } catch {
      setError("Could not save personal goals");
    } finally {
      setSaving(false);
    }
  }

  async function saveWeightPrGoal() {
    const exerciseId = prExerciseId ? parseInt(prExerciseId, 10) : NaN;
    const weight = weightPrTarget ? parseFloat(weightPrTarget) : NaN;
    const reps = weightPrReps ? parseInt(weightPrReps, 10) : NaN;
    if (!Number.isFinite(exerciseId) || !Number.isFinite(weight) || !Number.isFinite(reps)) {
      setError("Weight PR needs exercise, target weight (lbs), and rep count.");
      return;
    }
    await patchPersonalGoals(
      {
        pr_exercise_id: exerciseId,
        pr_weight_lbs: weight,
        pr_weight_at_reps: reps,
      },
      "Weight PR goal saved for this week."
    );
  }

  async function clearWeightPrGoal() {
    setWeightPrTarget("");
    setWeightPrReps("");
    await patchPersonalGoals({ clear_weight_pr: true }, "Weight PR goal cleared.");
  }

  async function saveRepsPrGoal() {
    const exerciseId = prExerciseId ? parseInt(prExerciseId, 10) : NaN;
    const weight = repsPrWeight ? parseFloat(repsPrWeight) : NaN;
    const reps = repsPrTarget ? parseInt(repsPrTarget, 10) : NaN;
    if (!Number.isFinite(exerciseId) || !Number.isFinite(weight) || !Number.isFinite(reps)) {
      setError("Reps PR needs exercise, weight (lbs), and target reps.");
      return;
    }
    await patchPersonalGoals(
      {
        pr_exercise_id: exerciseId,
        pr_reps_at_weight_lbs: weight,
        pr_reps_target: reps,
      },
      "Reps PR goal saved for this week."
    );
  }

  async function clearRepsPrGoal() {
    setRepsPrWeight("");
    setRepsPrTarget("");
    await patchPersonalGoals({ clear_reps_pr: true }, "Reps PR goal cleared.");
  }

  async function clearAllLiftGoals() {
    setPrExerciseId("");
    setWeightPrTarget("");
    setWeightPrReps("");
    setRepsPrWeight("");
    setRepsPrTarget("");
    setLiftSearch("");
    await patchPersonalGoals({ clear_pr: true }, "All lift goals cleared.");
  }

  async function saveWeighGoal() {
    if (!weighTarget.trim()) {
      setError("Enter a target weight.");
      return;
    }
    if (!weighDirection) {
      setError("Choose whether to weigh in at or below / above your target.");
      return;
    }
    const target = parseFloat(weighTarget);
    if (!Number.isFinite(target) || target <= 0) {
      setError("Enter a valid target weight.");
      return;
    }
    await patchPersonalGoals(
      {
        weigh_target_lbs: target,
        weigh_direction: weighDirection,
      },
      "Weigh-in goal saved for this week."
    );
  }

  async function clearWeighGoal() {
    setWeighTarget("");
    setWeighDirection("");
    await patchPersonalGoals({ clear_weigh: true }, "Weigh-in goal cleared.");
  }

  function formatGoalProgress(metric: GoalMetric | undefined, unit: string): string | null {
    if (!metric || metric.target <= 0) return null;
    if (metric.percent != null) return `${metric.hit}/${metric.target} ${unit} (${metric.percent}%)`;
    return `${metric.hit}/${metric.target} ${unit}`;
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
            {weeklyGoals?.workouts_per_week
              ? `Goal: ${weeklyGoals.workouts_per_week} workout${weeklyGoals.workouts_per_week === 1 ? "" : "s"} / week`
              : "Set how many workouts/week you want to log"}
            {formatGoalProgress(weeklyGoals?.workouts, "workouts") ? (
              <span className="block mt-1 text-stone-500">
                This week: {formatGoalProgress(weeklyGoals?.workouts, "workouts")}
              </span>
            ) : null}
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
            {formatGoalProgress(weeklyGoals?.macros, "days") ? (
              <span className="block mt-1 text-stone-500">This week: {formatGoalProgress(weeklyGoals?.macros, "days")}</span>
            ) : null}
          </p>
          <span className="text-sm text-brand-700 font-medium mt-2 inline-block">Open My Macros →</span>
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-stone-500">Loading personal goals…</p>
      ) : (
        <div className="space-y-4 border-t border-stone-200 pt-4">
          <h3 className="font-semibold text-stone-800">Personal goals (this week)</h3>
          {savedMessage && (
            <p className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">{savedMessage}</p>
          )}
          {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="p-4 rounded-lg border border-stone-200 bg-white space-y-5">
            <div>
              <p className="text-sm font-medium text-stone-700 mb-1">Lift PR goals</p>
              <p className="text-xs text-stone-500 mb-3">
                Pick one exercise, then set a weight PR, a reps PR, or both. Weight PR = heavier at a rep count (e.g. 200 lbs × 2 when your best was 175 × 2). Reps PR = more reps at a weight (e.g. 2 reps at 200 when your best was 1 rep at 200).
              </p>
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
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm w-full"
              />
              <datalist id="weekly-lift-options">
                {liftOptions.map((o) => (
                  <option key={o.id} value={o.name} />
                ))}
              </datalist>
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="text-sm font-medium text-stone-700 mb-2">Weight PR</p>
              <p className="text-xs text-stone-500 mb-2">Hit a new weight at this rep count.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={weightPrTarget}
                  onChange={(e) => setWeightPrTarget(e.target.value)}
                  placeholder="Target weight (lbs)"
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={weightPrReps}
                  onChange={(e) => setWeightPrReps(e.target.value)}
                  placeholder="At reps"
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveWeightPrGoal()}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save weight PR"}
                </button>
                {(weeklyGoals?.personal.pr_weight_lbs != null || weightPrTarget) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void clearWeightPrGoal()}
                    className="px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                  >
                    Clear weight PR
                  </button>
                )}
              </div>
              {weeklyGoals?.personal.pr_weight_lbs != null && weeklyGoals.personal.pr_weight_at_reps != null && (
                <p className={`text-xs mt-2 font-medium ${weeklyGoals.personal.weight_pr_hit ? "text-emerald-700" : "text-stone-500"}`}>
                  Weight PR:{" "}
                  {weeklyGoals.personal.weight_pr_hit
                    ? "Goal hit this week ✓"
                    : weeklyGoals.personal.weight_pr_percent != null
                      ? `${weeklyGoals.personal.weight_pr_percent}% toward ${weeklyGoals.personal.pr_weight_lbs} lbs × ${weeklyGoals.personal.pr_weight_at_reps}${
                          weeklyGoals.personal.weight_pr_baseline_lbs != null
                            ? ` (from ${weeklyGoals.personal.weight_pr_baseline_lbs} lbs)`
                            : ""
                        }`
                      : "No attempts yet this week"}
                </p>
              )}
            </div>

            <div className="border-t border-stone-100 pt-4">
              <p className="text-sm font-medium text-stone-700 mb-2">Reps PR</p>
              <p className="text-xs text-stone-500 mb-2">Hit more reps at this weight.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={repsPrWeight}
                  onChange={(e) => setRepsPrWeight(e.target.value)}
                  placeholder="At weight (lbs)"
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={repsPrTarget}
                  onChange={(e) => setRepsPrTarget(e.target.value)}
                  placeholder="Target reps"
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveRepsPrGoal()}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save reps PR"}
                </button>
                {(weeklyGoals?.personal.pr_reps_at_weight_lbs != null || repsPrWeight) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void clearRepsPrGoal()}
                    className="px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                  >
                    Clear reps PR
                  </button>
                )}
              </div>
              {weeklyGoals?.personal.pr_reps_at_weight_lbs != null && weeklyGoals.personal.pr_reps_target != null && (
                <p className={`text-xs mt-2 font-medium ${weeklyGoals.personal.reps_pr_hit ? "text-emerald-700" : "text-stone-500"}`}>
                  Reps PR:{" "}
                  {weeklyGoals.personal.reps_pr_hit
                    ? "Goal hit this week ✓"
                    : weeklyGoals.personal.reps_pr_percent != null
                      ? `${weeklyGoals.personal.reps_pr_percent}% toward ${weeklyGoals.personal.pr_reps_target} reps at ${weeklyGoals.personal.pr_reps_at_weight_lbs} lbs${
                          weeklyGoals.personal.reps_pr_baseline != null
                            ? ` (from ${weeklyGoals.personal.reps_pr_baseline} reps)`
                            : ""
                        }`
                      : "No attempts yet this week"}
                </p>
              )}
            </div>

            {(weeklyGoals?.personal.pr_exercise_id || prExerciseId) && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void clearAllLiftGoals()}
                className="text-xs text-stone-500 hover:text-stone-700 underline"
              >
                Clear all lift goals
              </button>
            )}
          </div>

          <div className="p-4 rounded-lg border border-stone-200 bg-white">
            <p className="text-sm font-medium text-stone-700 mb-2">Weekly weigh-in goal</p>
            <p className="text-xs text-stone-500 mb-3">
              Separate from your long-term weight goal in Macros. Progress uses your best weigh-in this week toward the target, starting from your first daily weigh-in this board week (Mon–Sun). That opening weight stays locked even when you log lower weights later.
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
                onClick={() => void saveWeighGoal()}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save weigh-in goal"}
              </button>
              {(weeklyGoals?.personal.weigh_target_lbs || weighTarget) && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void clearWeighGoal()}
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
                      ? `${weeklyGoals.personal.weigh_percent}% toward ${weeklyGoals.personal.weigh_target_lbs} lbs (from ${weeklyGoals.personal.weigh_baseline_lbs} lbs${
                          weeklyGoals.personal.weigh_current_lbs != null &&
                          weeklyGoals.personal.weigh_current_lbs !== weeklyGoals.personal.weigh_baseline_lbs
                            ? `, now ${weeklyGoals.personal.weigh_current_lbs} lbs`
                            : ""
                        })`
                      : "No weigh-in logged this week yet"}
              </p>
            )}
          </div>

          {weeklyGoals?.personal.personal_percent != null ? (
            <p className="text-sm text-stone-700">
              Personal goal score:{" "}
              <span className="font-semibold">{weeklyGoals.personal.personal_percent}%</span>
              {(() => {
                const parts = [
                  weeklyGoals.personal.weight_pr_percent != null
                    ? `weight PR ${weeklyGoals.personal.weight_pr_percent}%`
                    : null,
                  weeklyGoals.personal.reps_pr_percent != null
                    ? `reps PR ${weeklyGoals.personal.reps_pr_percent}%`
                    : null,
                  weeklyGoals.personal.weigh_percent != null
                    ? `weigh-in ${weeklyGoals.personal.weigh_percent}%`
                    : null,
                ].filter(Boolean);
                return parts.length > 0 ? <span className="text-stone-600"> ({parts.join(", ")})</span> : null;
              })()}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
