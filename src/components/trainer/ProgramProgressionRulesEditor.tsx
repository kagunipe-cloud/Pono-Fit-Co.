"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PHASE_STEP_PERCENT,
  TRAINING_PHASES,
  parseTrainingPhase,
  type TrainingPhase,
} from "@/lib/training-programs";
import type { ExerciseEntry } from "@/lib/trainer-workout-builder";

export type ProgressionRule = {
  id: number;
  program_workout_id: number;
  exercise_key: string;
  exercise_id: number | null;
  training_phase: string;
  target_reps_min: number | null;
  target_reps_max: number | null;
  starting_weight_lb: number | null;
  step_percent: number | null;
};

type Props = {
  programId: string;
  programWorkoutId: string;
  workoutPhase: string;
  exercises: ExerciseEntry[];
};

export default function ProgramProgressionRulesEditor({
  programId,
  programWorkoutId,
  workoutPhase,
  exercises,
}: Props) {
  const [rules, setRules] = useState<ProgressionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [exerciseKey, setExerciseKey] = useState("");
  const [exerciseId, setExerciseId] = useState<number | null>(null);
  const [rulePhase, setRulePhase] = useState(workoutPhase);
  const [repMin, setRepMin] = useState("8");
  const [repMax, setRepMax] = useState("12");
  const [startWeight, setStartWeight] = useState("");
  const [stepPercent, setStepPercent] = useState("");

  const lifts = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; name: string; id: number | null }[] = [];
    for (const e of exercises) {
      if (e.type !== "lift" || !e.exercise_name.trim()) continue;
      const key = e.exercise_name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, name: e.exercise_name.trim(), id: e.exercise_id ?? null });
    }
    return out;
  }, [exercises]);

  const loadRules = useCallback(() => {
    setLoading(true);
    fetch(`/api/trainer/programs/${programId}/workouts/${programWorkoutId}/progression-rules`)
      .then((r) => (r.ok ? r.json() : { rules: [] }))
      .then((d) => setRules(Array.isArray(d.rules) ? d.rules : []))
      .finally(() => setLoading(false));
  }, [programId, programWorkoutId]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  useEffect(() => {
    setRulePhase(workoutPhase);
  }, [workoutPhase]);

  useEffect(() => {
    if (!exerciseKey && lifts.length > 0) {
      setExerciseKey(lifts[0]!.key);
      setExerciseId(lifts[0]!.id);
    }
  }, [lifts, exerciseKey]);

  const defaultPct = DEFAULT_PHASE_STEP_PERCENT[parseTrainingPhase(rulePhase) as TrainingPhase];

  function fillFormForSelection(key: string, phase: string) {
    const existing = rules.find((r) => r.exercise_key === key && r.training_phase === phase);
    if (existing) {
      setRepMin(String(existing.target_reps_min ?? 8));
      setRepMax(String(existing.target_reps_max ?? 12));
      setStartWeight(existing.starting_weight_lb != null ? String(existing.starting_weight_lb) : "");
      setStepPercent(existing.step_percent != null ? String(existing.step_percent) : "");
    } else {
      setRepMin("8");
      setRepMax("12");
      setStartWeight("");
      setStepPercent("");
    }
  }

  function onPickLift(key: string) {
    setExerciseKey(key);
    const lift = lifts.find((l) => l.key === key);
    setExerciseId(lift?.id ?? null);
    fillFormForSelection(key, rulePhase);
  }

  function onPickPhase(phase: string) {
    setRulePhase(phase);
    if (exerciseKey) fillFormForSelection(exerciseKey, phase);
  }

  async function saveRule() {
    setMessage(null);
    const minR = parseInt(repMin, 10);
    const maxR = parseInt(repMax, 10);
    if (!exerciseKey) {
      setMessage("Add lifts to the workout first, then pick one.");
      return;
    }
    if (!Number.isFinite(minR) || !Number.isFinite(maxR) || minR < 1 || maxR < minR) {
      setMessage("Rep range: min ≤ max, min at least 1.");
      return;
    }
    const sw = startWeight.trim() ? parseFloat(startWeight) : null;
    const sp = stepPercent.trim() ? parseFloat(stepPercent) : null;

    setSaving(true);
    try {
      const res = await fetch(`/api/trainer/programs/${programId}/workouts/${programWorkoutId}/progression-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_key: exerciseKey,
          exercise_id: exerciseId,
          training_phase: rulePhase,
          target_reps_min: minR,
          target_reps_max: maxR,
          starting_weight_lb: sw,
          step_percent: sp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Could not save rule");
        return;
      }
      setMessage("Saved progression rule.");
      loadRules();
    } finally {
      setSaving(false);
    }
  }

  async function applyDefaultsToAllLifts() {
    setMessage(null);
    const phase = parseTrainingPhase(workoutPhase);
    const missing = lifts.filter((l) => !rules.some((r) => r.exercise_key === l.key && r.training_phase === phase));
    if (missing.length === 0) {
      setMessage(`Every lift already has a ${phase} rule on this workout.`);
      return;
    }
    const pct = DEFAULT_PHASE_STEP_PERCENT[phase];
    if (
      !confirm(
        `Add ${phase} rules for ${missing.length} lift(s): 8–12 reps, default +${pct}% step. Won't change rules you already set.`
      )
    ) {
      return;
    }

    setBulkSaving(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const lift of missing) {
        const res = await fetch(`/api/trainer/programs/${programId}/workouts/${programWorkoutId}/progression-rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exercise_key: lift.key,
            exercise_id: lift.id,
            training_phase: phase,
            target_reps_min: 8,
            target_reps_max: 12,
            starting_weight_lb: null,
            step_percent: null,
          }),
        });
        if (res.ok) ok++;
        else failed++;
      }
      setMessage(
        failed === 0
          ? `Added ${ok} default rule${ok === 1 ? "" : "s"} for ${phase}. Tweak any lift below if needed.`
          : `Added ${ok}; ${failed} could not save — check lifts and try again.`
      );
      loadRules();
    } finally {
      setBulkSaving(false);
    }
  }

  async function deleteRule(rule: ProgressionRule) {
    if (!confirm(`Remove progression for ${rule.exercise_key} (${rule.training_phase})?`)) return;
    await fetch(`/api/trainer/programs/${programId}/workouts/${programWorkoutId}/progression-rules`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exercise_key: rule.exercise_key, training_phase: rule.training_phase }),
    });
    loadRules();
  }

  if (lifts.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
        <p className="font-medium text-stone-800">Auto progression</p>
        <p className="mt-1">Add at least one lift above to set rep targets and % bumps per phase.</p>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-xl border border-stone-200 bg-stone-50/80 p-4">
      <h2 className="text-sm font-semibold text-stone-800">Auto progression (trainer/admin)</h2>
      <p className="text-xs text-stone-600 mt-1 leading-relaxed">
        When the client hits the rep band for this lift <strong>and</strong> this workout&apos;s phase matches the rule, load goes up by your{" "}
        <strong>step %</strong> (rounded to nearest 5 lb). If the bar wouldn&apos;t move, they get <strong>+3 reps/set</strong> instead. Each phase
        (DELOAD, VOLUME, etc.) can have its own rule per lift.
      </p>

      {loading ? (
        <p className="text-sm text-stone-500 mt-3">Loading rules…</p>
      ) : rules.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
              <span className="text-stone-800">
                <span className="font-medium capitalize">{r.exercise_key}</span>
                <span className="text-stone-500"> · {r.training_phase}</span>
                <span className="text-stone-600">
                  {" "}
                  · {r.target_reps_min}–{r.target_reps_max} reps
                </span>
                {r.starting_weight_lb != null && (
                  <span className="text-stone-500"> · start {r.starting_weight_lb} lb</span>
                )}
                <span className="text-brand-700 font-medium">
                  {" "}
                  · +{r.step_percent ?? DEFAULT_PHASE_STEP_PERCENT[parseTrainingPhase(r.training_phase) as TrainingPhase]}%
                </span>
              </span>
              <button type="button" onClick={() => void deleteRule(r)} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-stone-500 mt-3">No rules yet for this workout.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={bulkSaving || saving || loading}
          onClick={() => void applyDefaultsToAllLifts()}
          className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {bulkSaving ? "Adding…" : `Default rules for all lifts (${workoutPhase})`}
        </button>
        <span className="text-[11px] text-stone-500">8–12 reps · phase default % · skips lifts that already have this phase</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-stone-700 sm:col-span-2">
          Lift
          <select
            value={exerciseKey}
            onChange={(e) => onPickLift(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
          >
            {lifts.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-stone-700">
          Rule phase
          <select
            value={rulePhase}
            onChange={(e) => onPickPhase(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
          >
            {TRAINING_PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-stone-700">
          Step % (optional)
          <input
            type="number"
            step="0.5"
            placeholder={`Default ${defaultPct}%`}
            value={stepPercent}
            onChange={(e) => setStepPercent(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-stone-700">
          Rep min
          <input
            type="number"
            min={1}
            value={repMin}
            onChange={(e) => setRepMin(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-stone-700">
          Rep max
          <input
            type="number"
            min={1}
            value={repMax}
            onChange={(e) => setRepMax(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-stone-700 sm:col-span-2">
          Starting weight (lb, optional)
          <input
            type="number"
            step="5"
            value={startWeight}
            onChange={(e) => setStartWeight(e.target.value)}
            placeholder="First time they run this lift in the program"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void saveRule()}
        className="mt-4 px-4 py-2 rounded-lg border border-stone-300 bg-white text-sm font-medium hover:bg-stone-100 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save progression rule"}
      </button>
      {message && <p className="mt-2 text-xs text-stone-600">{message}</p>}
    </div>
  );
}