"use client";

import { useState } from "react";
import Link from "next/link";

type SetRow = { reps: string; weight: string } | { time: string; distance: string };
type ExerciseEntry = {
  type: "lift" | "cardio";
  exercise_name: string;
  sets: SetRow[];
};

export default function AdminCreateWorkoutForMemberPage() {
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [mode, setMode] = useState<"lift" | "cardio" | null>(null);
  const [exerciseName, setExerciseName] = useState("");
  const [sets, setSets] = useState<SetRow[]>([{ reps: "", weight: "" }]);
  const [memberEmail, setMemberEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function startAddLift() {
    setMode("lift");
    setExerciseName("");
    setSets([{ reps: "", weight: "" }]);
  }

  function startAddCardio() {
    setMode("cardio");
    setExerciseName("");
    setSets([{ time: "", distance: "" }]);
  }

  function addSet() {
    if (mode === "lift") setSets((s) => [...s, { reps: "", weight: "" }]);
    else setSets((s) => [...s, { time: "", distance: "" }]);
  }

  function saveExercise() {
    if (!exerciseName.trim()) return;
    setExercises((e) => [
      ...e,
      {
        type: mode!,
        exercise_name: exerciseName.trim(),
        sets: [...sets],
      },
    ]);
    setMode(null);
    setExerciseName("");
    setSets([{ reps: "", weight: "" }]);
  }

  function removeExercise(index: number) {
    setExercises((e) => e.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const email = memberEmail.trim();
    if (!email) {
      setError("Enter the member's email.");
      return;
    }
    if (exercises.length === 0) {
      setError("Add at least one exercise.");
      return;
    }

    const payload = {
      member_email: email,
      exercises: exercises.map((ex) =>
        ex.type === "lift"
          ? {
              type: "lift" as const,
              exercise_name: ex.exercise_name,
              sets: (ex.sets as { reps: string; weight: string }[]).map((s) => ({
                reps: parseInt(s.reps, 10) || null,
                weight_kg: parseFloat(s.weight) || null,
              })),
            }
          : {
              type: "cardio" as const,
              exercise_name: ex.exercise_name,
              sets: (ex.sets as { time: string; distance: string }[]).map((s) => ({
                time_seconds: parseInt(s.time, 10) ? parseInt(s.time, 10) * 60 : null,
                distance_km: parseFloat(s.distance) || null,
              })),
            }
      ),
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/workouts/create-for-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to post workout");
        return;
      }
      setSuccess(data?.message ?? "Workout posted. The member can see it and repeat it from their Workouts page.");
      setMemberEmail("");
      setExercises([]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <Link href="/member" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">← Back</Link>
        <h1 className="text-2xl font-bold text-stone-800">Create Workout for Member</h1>
        <p className="text-stone-500 text-sm mt-1">
          Add exercises and sets, then enter the member&apos;s email to post this workout to their Workouts page. They can repeat it from there.
        </p>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-800 text-sm">{success}</div>}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div>
          <h2 className="text-sm font-medium text-stone-600 mb-3">Exercises</h2>
          {!mode ? (
            <div className="flex flex-wrap gap-3 mb-4">
              <button
                type="button"
                onClick={startAddLift}
                className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
              >
                Add Lift
              </button>
              <button
                type="button"
                onClick={startAddCardio}
                className="px-4 py-2.5 rounded-lg border border-stone-200 bg-white font-medium hover:bg-stone-50"
              >
                Add Cardio
              </button>
            </div>
          ) : (
            <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-4">
              <h3 className="font-semibold text-stone-800">{mode === "lift" ? "Add Lift" : "Add Cardio"}</h3>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Exercise</label>
                <input
                  type="text"
                  value={exerciseName}
                  onChange={(e) => setExerciseName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                  placeholder="e.g. Bench Press, Treadmill"
                />
              </div>
              {mode === "lift" ? (
                (sets as { reps: string; weight: string }[]).map((row, i) => (
                  <div key={i} className="flex gap-2 flex-wrap items-center">
                    <span className="text-sm text-stone-500 w-8">Set {i + 1}</span>
                    <input
                      type="text"
                      placeholder="Reps"
                      value={row.reps}
                      onChange={(e) => {
                        const next = [...sets];
                        (next[i] as { reps: string; weight: string }).reps = e.target.value;
                        setSets(next);
                      }}
                      className="w-20 px-2 py-1.5 rounded border border-stone-200"
                    />
                    <input
                      type="text"
                      placeholder="Weight (lbs)"
                      value={row.weight}
                      onChange={(e) => {
                        const next = [...sets];
                        (next[i] as { reps: string; weight: string }).weight = e.target.value;
                        setSets(next);
                      }}
                      className="w-24 px-2 py-1.5 rounded border border-stone-200"
                    />
                  </div>
                ))
              ) : (
                (sets as { time: string; distance: string }[]).map((row, i) => (
                  <div key={i} className="flex gap-2 flex-wrap items-center">
                    <span className="text-sm text-stone-500 w-8">Set {i + 1}</span>
                    <input
                      type="text"
                      placeholder="Time (min)"
                      value={row.time}
                      onChange={(e) => {
                        const next = [...sets];
                        (next[i] as { time: string; distance: string }).time = e.target.value;
                        setSets(next);
                      }}
                      className="w-24 px-2 py-1.5 rounded border border-stone-200"
                    />
                    <input
                      type="text"
                      placeholder="Distance (km)"
                      value={row.distance}
                      onChange={(e) => {
                        const next = [...sets];
                        (next[i] as { time: string; distance: string }).distance = e.target.value;
                        setSets(next);
                      }}
                      className="w-24 px-2 py-1.5 rounded border border-stone-200"
                    />
                  </div>
                ))
              )}
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={saveExercise} disabled={!exerciseName.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
                  Save exercise
                </button>
                <button type="button" onClick={addSet} className="px-4 py-2 rounded-lg border border-stone-200 bg-white font-medium hover:bg-stone-50">
                  Add set
                </button>
                <button type="button" onClick={() => setMode(null)} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">
                  Cancel
                </button>
              </div>
              {mode === "cardio" && <p className="text-xs text-stone-500">Time in minutes; distance in km.</p>}
            </div>
          )}

          {exercises.length > 0 && (
            <ul className="space-y-2">
              {exercises.map((ex, i) => (
                <li key={i} className="flex items-center justify-between p-3 rounded-lg border border-stone-200 bg-white">
                  <span className="font-medium text-stone-800">
                    {ex.exercise_name}
                    <span className="ml-2 text-xs text-stone-500 capitalize">({ex.type})</span>
                    <span className="ml-2 text-xs text-stone-400">— {ex.sets.length} set(s)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeExercise(i)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pt-4 border-t border-stone-200">
          <label className="block text-sm font-medium text-stone-700 mb-1">Member email</label>
          <input
            type="email"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            className="w-full max-w-md px-3 py-2 rounded-lg border border-stone-200"
            placeholder="member@example.com"
            required
          />
          <p className="text-xs text-stone-500 mt-1">Workout will be posted to this member&apos;s Workouts page. They can repeat it anytime.</p>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || exercises.length === 0 || !memberEmail.trim()}
            className="px-6 py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Posting…" : "Post to member's workouts"}
          </button>
          <Link href="/member" className="px-6 py-3 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium text-stone-700">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
