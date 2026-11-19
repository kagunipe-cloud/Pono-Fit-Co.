"use client";

import { useEffect, useState } from "react";
import type { ExerciseEntry, OfficialExercise, SetRow } from "@/lib/trainer-workout-builder";

type Props = {
  exerciseSearchMemberId: string;
  exercises: ExerciseEntry[];
  onExercisesChange: (next: ExerciseEntry[]) => void;
  showUseForMy1rm?: boolean;
};

export default function TrainerWorkoutExerciseBuilder({
  exerciseSearchMemberId,
  exercises,
  onExercisesChange,
  showUseForMy1rm = true,
}: Props) {
  const [mode, setMode] = useState<"lift" | "cardio" | null>(null);
  const [exerciseName, setExerciseName] = useState("");
  const [selectedOfficialId, setSelectedOfficialId] = useState<number | null>(null);
  const [exerciseSuggestions, setExerciseSuggestions] = useState<OfficialExercise[]>([]);
  const [sets, setSets] = useState<SetRow[]>([{ reps: "", weight: "" }]);
  const [useForMy1rm, setUseForMy1rm] = useState(false);

  const [showAddExercise, setShowAddExercise] = useState(false);
  const [newExName, setNewExName] = useState("");
  const [newExType, setNewExType] = useState<"lift" | "cardio">("lift");
  const [newExPrimaryMuscles, setNewExPrimaryMuscles] = useState("");
  const [newExMuscleGroup, setNewExMuscleGroup] = useState("");
  const [newExEquipment, setNewExEquipment] = useState("");
  const [newExInstructions, setNewExInstructions] = useState("");
  const [savingNewEx, setSavingNewEx] = useState(false);
  const [newExError, setNewExError] = useState<string | null>(null);

  const boostId = exerciseSearchMemberId.trim() || "";

  useEffect(() => {
    if (!mode) {
      setExerciseSuggestions([]);
      return;
    }
    if (!exerciseName.trim()) {
      let cancelled = false;
      const qs = boostId ? `&for_member_id=${encodeURIComponent(boostId)}` : "";
      fetch(`/api/member/exercises/frequent?type=${mode}&limit=20${qs}`)
        .then((r) => (r.ok ? r.json() : { exercises: [] }))
        .then((d: { exercises?: OfficialExercise[] }) => {
          if (!cancelled) setExerciseSuggestions(Array.isArray(d.exercises) ? d.exercises : []);
        })
        .catch(() => {
          if (!cancelled) setExerciseSuggestions([]);
        });
      return () => {
        cancelled = true;
      };
    }
    const t = setTimeout(() => {
      const boost = boostId ? `&boost_member=1&boost_for_member_id=${encodeURIComponent(boostId)}` : "";
      fetch(`/api/exercises?q=${encodeURIComponent(exerciseName.trim())}&type=${mode}${boost}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list: OfficialExercise[]) => setExerciseSuggestions(list))
        .catch(() => setExerciseSuggestions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [mode, exerciseName, boostId]);

  function startAddLift() {
    setMode("lift");
    setExerciseName("");
    setSelectedOfficialId(null);
    setExerciseSuggestions([]);
    setSets([{ reps: "", weight: "" }]);
  }

  function startAddCardio() {
    setMode("cardio");
    setExerciseName("");
    setSelectedOfficialId(null);
    setExerciseSuggestions([]);
    setSets([{ time: "", distance: "" }]);
  }

  function pickOfficialExercise(ex: OfficialExercise) {
    setExerciseName(ex.name);
    setSelectedOfficialId(ex.id);
    setExerciseSuggestions([]);
  }

  function onExerciseInputBlur() {
    const match = exerciseSuggestions.find((e) => e.name.toLowerCase() === exerciseName.trim().toLowerCase());
    if (match) setSelectedOfficialId(match.id);
  }

  function addSet() {
    if (mode === "lift") setSets((s) => [...s, { reps: "", weight: "" }]);
    else setSets((s) => [...s, { time: "", distance: "" }]);
  }

  function saveExercise() {
    if (!exerciseName.trim() || !mode) return;
    const picked = exerciseSuggestions.find((e) => e.id === selectedOfficialId);
    onExercisesChange([
      ...exercises,
      {
        type: mode,
        exercise_name: exerciseName.trim(),
        exercise_id: selectedOfficialId ?? undefined,
        muscle_group: picked?.muscle_group ?? undefined,
        primary_muscles: picked?.primary_muscles ?? undefined,
        equipment: picked?.equipment ?? undefined,
        use_for_my_1rm: showUseForMy1rm && mode === "lift" && useForMy1rm && selectedOfficialId != null,
        sets: [...sets],
      },
    ]);
    setMode(null);
    setExerciseName("");
    setSelectedOfficialId(null);
    setExerciseSuggestions([]);
    setUseForMy1rm(false);
    setSets([{ reps: "", weight: "" }]);
  }

  function removeExercise(index: number) {
    onExercisesChange(exercises.filter((_, i) => i !== index));
  }

  function moveExerciseInList(from: number, direction: -1 | 1) {
    const to = from + direction;
    if (to < 0 || to >= exercises.length) return;
    const next = [...exercises];
    const a = next[from]!;
    const b = next[to]!;
    next[from] = b;
    next[to] = a;
    onExercisesChange(next);
  }

  async function handleAddExerciseToDb(e: React.FormEvent) {
    e.preventDefault();
    setNewExError(null);
    if (!newExName.trim()) {
      setNewExError("Name required");
      return;
    }
    setSavingNewEx(true);
    try {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newExName.trim(),
          type: newExType,
          primary_muscles: newExPrimaryMuscles.trim() || undefined,
          muscle_group: newExMuscleGroup.trim() || undefined,
          equipment: newExEquipment.trim() || undefined,
          instructions: newExInstructions.trim()
            ? newExInstructions.trim().split("\n").map((s) => s.trim()).filter(Boolean)
            : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNewExError((data as { error?: string }).error ?? "Failed to add exercise");
        return;
      }
      setShowAddExercise(false);
      setNewExName("");
      setNewExType("lift");
      setNewExPrimaryMuscles("");
      setNewExMuscleGroup("");
      setNewExEquipment("");
      setNewExInstructions("");
    } finally {
      setSavingNewEx(false);
    }
  }

  return (
  <>
    <label className="block text-sm font-medium text-stone-600 mb-3">Exercises</label>
    {!mode ? (
      <div className="flex flex-wrap gap-3 mb-4">
        <button type="button" onClick={startAddLift} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">
          Add Lift
        </button>
        <button type="button" onClick={startAddCardio} className="px-4 py-2.5 rounded-lg border border-stone-200 bg-white font-medium hover:bg-stone-50">
          Add Cardio
        </button>
        <button type="button" onClick={() => setShowAddExercise(true)} className="px-4 py-2.5 rounded-lg border border-stone-200 bg-white font-medium hover:bg-stone-50 text-stone-700">
          Add exercise
        </button>
      </div>
    ) : (
      <>
        <div className="mb-4 p-4 rounded-xl border border-stone-200 bg-stone-50">
          <h3 className="font-semibold text-stone-800 mb-3">{mode === "lift" ? "Add Lift" : "Add Cardio"}</h3>
          <label className="block text-sm font-medium text-stone-600 mb-1">Choose exercise</label>
          <input
            type="text"
            value={exerciseName}
            onChange={(e) => {
              setExerciseName(e.target.value);
              setSelectedOfficialId(null);
            }}
            onBlur={onExerciseInputBlur}
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
            placeholder="e.g. Bench Press, Treadmill"
            autoComplete="off"
          />
          {exerciseSuggestions.length > 0 && !exerciseName.trim() && boostId && (
            <p className="mt-2 text-xs font-semibold text-stone-600">Pinned &amp; often used</p>
          )}
          {exerciseSuggestions.length > 0 && (
            <ul className="mt-1 border border-stone-200 rounded-lg bg-white shadow-sm max-h-40 overflow-auto">
              {exerciseSuggestions.map((ex) => (
                <li key={ex.id}>
                  <button type="button" onClick={() => pickOfficialExercise(ex)} className="w-full text-left px-3 py-2 text-sm text-stone-800 hover:bg-stone-100">
                    {ex.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showUseForMy1rm && mode === "lift" && selectedOfficialId != null && exerciseName.trim() && (
            <label className="mt-3 flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useForMy1rm} onChange={(e) => setUseForMy1rm(e.target.checked)} className="rounded border-stone-300 text-brand-600" />
              <span className="text-sm text-stone-700">Use for My 1RM Calculation</span>
            </label>
          )}
        </div>

        {exerciseName.trim() && (
          <div className="mb-6 p-4 rounded-xl border-2 border-stone-300 bg-white shadow-sm space-y-4">
            <p className="font-semibold text-stone-800">
              {exerciseName.trim()}
              <span className="ml-2 text-xs font-normal text-stone-500 capitalize">({mode})</span>
            </p>
            {mode === "lift"
              ? (sets as { reps: string; weight: string }[]).map((row, i) => (
                  <div key={i} className="flex gap-2 flex-wrap items-center">
                    <span className="text-sm text-stone-500 w-10">Set {i + 1}</span>
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
              : (sets as { time: string; distance: string }[]).map((row, i) => (
                  <div key={i} className="flex gap-2 flex-wrap items-center">
                    <span className="text-sm text-stone-500 w-10">Set {i + 1}</span>
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
                      placeholder="Distance (mi)"
                      value={row.distance}
                      onChange={(e) => {
                        const next = [...sets];
                        (next[i] as { time: string; distance: string }).distance = e.target.value;
                        setSets(next);
                      }}
                      className="w-24 px-2 py-1.5 rounded border border-stone-200"
                    />
                  </div>
                ))}
            {mode === "cardio" && <p className="text-xs text-stone-500">Time in minutes; distance in miles.</p>}
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={saveExercise} disabled={!exerciseName.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
                Add to workout
              </button>
              <button type="button" onClick={addSet} className="px-4 py-2 rounded-lg border border-stone-200 bg-white font-medium hover:bg-stone-50">
                Add set
              </button>
              <button type="button" onClick={() => setMode(null)} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">
                Cancel
              </button>
            </div>
          </div>
        )}
      </>
    )}

    {exercises.length > 0 && (
      <ul className="space-y-2">
        {exercises.map((ex, i) => (
          <li key={`${ex.exercise_name}-${i}`} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-stone-200 bg-white">
            <span className="font-medium text-stone-800 min-w-0">
              {ex.exercise_name}
              <span className="ml-2 text-xs text-stone-500 capitalize">({ex.type})</span>
              <span className="ml-2 text-xs text-stone-400">— {ex.sets.length} set(s)</span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              {exercises.length > 1 && (
                <span className="inline-flex items-center gap-0.5">
                  <button type="button" onClick={() => moveExerciseInList(i, -1)} disabled={i === 0} className="px-2 py-0.5 rounded border border-stone-200 text-stone-600 text-sm hover:bg-stone-50 disabled:opacity-40" aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" onClick={() => moveExerciseInList(i, 1)} disabled={i >= exercises.length - 1} className="px-2 py-0.5 rounded border border-stone-200 text-stone-600 text-sm hover:bg-stone-50 disabled:opacity-40" aria-label="Move down">
                    ↓
                  </button>
                </span>
              )}
              <button type="button" onClick={() => removeExercise(i)} className="text-sm text-red-600 hover:underline">
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
    )}

    {showAddExercise && (
      <>
        <div className="fixed inset-0 bg-stone-900/50 z-40" aria-hidden onClick={() => setShowAddExercise(false)} />
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-stone-800 mb-4">Add exercise to database</h3>
          {newExError && <div className="mb-3 p-2 rounded-lg bg-red-50 text-red-700 text-sm">{newExError}</div>}
          <form onSubmit={handleAddExerciseToDb} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-1">Name *</label>
              <input type="text" value={newExName} onChange={(e) => setNewExName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-600 mb-1">Type</label>
              <select value={newExType} onChange={(e) => setNewExType(e.target.value === "cardio" ? "cardio" : "lift")} className="w-full px-3 py-2 rounded-lg border border-stone-200">
                <option value="lift">Lift</option>
                <option value="cardio">Cardio</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={savingNewEx || !newExName.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
                {savingNewEx ? "Saving…" : "Add exercise"}
              </button>
              <button type="button" onClick={() => { setShowAddExercise(false); setNewExError(null); }} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </>
    )}
  </>
  );
}