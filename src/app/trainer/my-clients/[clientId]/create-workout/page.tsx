"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type SetRow = { reps: string; weight: string } | { time: string; distance: string };
type ExerciseEntry = {
  type: "lift" | "cardio";
  exercise_name: string;
  exercise_id?: number | null;
  muscle_group?: string;
  primary_muscles?: string;
  equipment?: string;
  instructions?: string;
  sets: SetRow[];
};
type OfficialExercise = { id: number; name: string; type: string; primary_muscles?: string; muscle_group?: string; equipment?: string };

export default function TrainerCreateWorkoutForClientPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = (params.clientId as string) ?? "";
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [mode, setMode] = useState<"lift" | "cardio" | null>(null);
  const [exerciseName, setExerciseName] = useState("");
  const [selectedOfficialId, setSelectedOfficialId] = useState<number | null>(null);
  const [exerciseSuggestions, setExerciseSuggestions] = useState<OfficialExercise[]>([]);
  const [sets, setSets] = useState<SetRow[]>([{ reps: "", weight: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [trainerNotes, setTrainerNotes] = useState("");

  const [showAddExercise, setShowAddExercise] = useState(false);
  const [newExName, setNewExName] = useState("");
  const [newExType, setNewExType] = useState<"lift" | "cardio">("lift");
  const [newExPrimaryMuscles, setNewExPrimaryMuscles] = useState("");
  const [newExMuscleGroup, setNewExMuscleGroup] = useState("");
  const [newExEquipment, setNewExEquipment] = useState("");
  const [newExInstructions, setNewExInstructions] = useState("");
  const [savingNewEx, setSavingNewEx] = useState(false);
  const [newExError, setNewExError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode || !exerciseName.trim()) {
      setExerciseSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/exercises?q=${encodeURIComponent(exerciseName.trim())}&type=${mode}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list: OfficialExercise[]) => setExerciseSuggestions(list))
        .catch(() => setExerciseSuggestions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [mode, exerciseName]);

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
    if (!exerciseName.trim()) return;
    const picked = exerciseSuggestions.find((e) => e.id === selectedOfficialId);
    setExercises((e) => [
      ...e,
      {
        type: mode!,
        exercise_name: exerciseName.trim(),
        exercise_id: selectedOfficialId ?? undefined,
        muscle_group: picked?.muscle_group ?? undefined,
        primary_muscles: picked?.primary_muscles ?? undefined,
        equipment: picked?.equipment ?? undefined,
        sets: [...sets],
      },
    ]);
    setMode(null);
    setExerciseName("");
    setSelectedOfficialId(null);
    setExerciseSuggestions([]);
    setSets([{ reps: "", weight: "" }]);
  }

  function removeExercise(index: number) {
    setExercises((e) => e.filter((_, i) => i !== index));
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!clientId) {
      setError("Client not found.");
      return;
    }
    if (exercises.length === 0) {
      setError("Add at least one exercise.");
      return;
    }

    const payload = {
      client_member_id: clientId,
      trainer_notes: trainerNotes.trim() || undefined,
      exercises: exercises.map((ex) =>
        ex.type === "lift"
          ? {
              type: "lift" as const,
              exercise_id: ex.exercise_id ?? undefined,
              exercise_name: ex.exercise_name,
              muscle_group: ex.muscle_group,
              primary_muscles: ex.primary_muscles,
              equipment: ex.equipment,
              instructions: ex.instructions ? ex.instructions.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
              sets: (ex.sets as { reps: string; weight: string }[]).map((s) => ({
                reps: parseInt(s.reps, 10) || null,
                weight_kg: parseFloat(s.weight) || null,
              })),
            }
          : {
              type: "cardio" as const,
              exercise_id: ex.exercise_id ?? undefined,
              exercise_name: ex.exercise_name,
              muscle_group: ex.muscle_group,
              primary_muscles: ex.primary_muscles,
              equipment: ex.equipment,
              instructions: ex.instructions ? ex.instructions.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
              sets: (ex.sets as { time: string; distance: string }[]).map((s) => ({
                time_seconds: parseInt(s.time, 10) ? parseInt(s.time, 10) * 60 : null,
                distance_km: parseFloat(s.distance) || null,
              })),
            }
      ),
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/trainer/workouts/create-for-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to send workout");
        return;
      }
      setSuccess((data as { message?: string }).message ?? "Workout sent. Client will see it under Workouts from my trainer.");
      setExercises([]);
      setTimeout(() => router.push(`/trainer/my-clients/${clientId}`), 1500);
    } finally {
      setSubmitting(false);
    }
  }

  if (!clientId) return <div className="p-6 text-stone-500">No client selected.</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <Link href={`/trainer/my-clients/${clientId}`} className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">← Client dashboard</Link>
        <h1 className="text-2xl font-bold text-stone-800">Create Workout for Member</h1>
        <p className="text-stone-500 text-sm mt-1">
          Add exercises and optional suggested sets. The client will see this under &quot;Workouts from my trainer&quot; and can fill in sets, reps, and weight, then finish to send results back to you.
        </p>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-800 text-sm">{success}</div>}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div>
          <h2 className="text-sm font-medium text-stone-600 mb-3">Exercises</h2>
          {!mode ? (
            <div className="flex flex-wrap gap-3 mb-4">
              <button type="button" onClick={startAddLift} className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">Add Lift</button>
              <button type="button" onClick={startAddCardio} className="px-4 py-2.5 rounded-lg border border-stone-200 bg-white font-medium hover:bg-stone-50">Add Cardio</button>
              <button type="button" onClick={() => setShowAddExercise(true)} className="px-4 py-2.5 rounded-lg border border-stone-200 bg-white font-medium hover:bg-stone-50 text-stone-700">Add exercise</button>
            </div>
          ) : (
            <>
              <div className="mb-4 p-4 rounded-xl border border-stone-200 bg-stone-50">
                <h3 className="font-semibold text-stone-800 mb-3">{mode === "lift" ? "Add Lift" : "Add Cardio"}</h3>
                <label className="block text-sm font-medium text-stone-600 mb-1">Choose exercise</label>
                <input
                  type="text"
                  value={exerciseName}
                  onChange={(e) => { setExerciseName(e.target.value); setSelectedOfficialId(null); }}
                  onBlur={onExerciseInputBlur}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200"
                  placeholder="e.g. Bench Press, Treadmill"
                  autoComplete="off"
                />
                {exerciseSuggestions.length > 0 && (
                  <ul className="mt-1 border border-stone-200 rounded-lg bg-white shadow-sm max-h-40 overflow-auto">
                    {exerciseSuggestions.map((ex) => (
                      <li key={ex.id}>
                        <button type="button" onClick={() => pickOfficialExercise(ex)} className="w-full text-left px-3 py-2 text-sm text-stone-800 hover:bg-stone-100">{ex.name}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {exerciseName.trim() && (
                <div className="mb-6 p-4 rounded-xl border-2 border-stone-300 bg-white shadow-sm space-y-4">
                  <p className="font-semibold text-stone-800">
                    {exerciseName.trim()}
                    <span className="ml-2 text-xs font-normal text-stone-500 capitalize">({mode})</span>
                  </p>
                  {mode === "lift" ? (
                    (sets as { reps: string; weight: string }[]).map((row, i) => (
                      <div key={i} className="flex gap-2 flex-wrap items-center">
                        <span className="text-sm text-stone-500 w-10">Set {i + 1}</span>
                        <input type="text" placeholder="Reps" value={row.reps} onChange={(e) => { const next = [...sets]; (next[i] as { reps: string; weight: string }).reps = e.target.value; setSets(next); }} className="w-20 px-2 py-1.5 rounded border border-stone-200" />
                        <input type="text" placeholder="Weight (lbs)" value={row.weight} onChange={(e) => { const next = [...sets]; (next[i] as { reps: string; weight: string }).weight = e.target.value; setSets(next); }} className="w-24 px-2 py-1.5 rounded border border-stone-200" />
                      </div>
                    ))
                  ) : (
                    (sets as { time: string; distance: string }[]).map((row, i) => (
                      <div key={i} className="flex gap-2 flex-wrap items-center">
                        <span className="text-sm text-stone-500 w-10">Set {i + 1}</span>
                        <input type="text" placeholder="Time (min)" value={row.time} onChange={(e) => { const next = [...sets]; (next[i] as { time: string; distance: string }).time = e.target.value; setSets(next); }} className="w-24 px-2 py-1.5 rounded border border-stone-200" />
                        <input type="text" placeholder="Distance (km)" value={row.distance} onChange={(e) => { const next = [...sets]; (next[i] as { time: string; distance: string }).distance = e.target.value; setSets(next); }} className="w-24 px-2 py-1.5 rounded border border-stone-200" />
                      </div>
                    ))
                  )}
                  {mode === "cardio" && <p className="text-xs text-stone-500">Time in minutes; distance in km.</p>}
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={saveExercise} disabled={!exerciseName.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">Add to workout</button>
                    <button type="button" onClick={addSet} className="px-4 py-2 rounded-lg border border-stone-200 bg-white font-medium hover:bg-stone-50">Add set</button>
                    <button type="button" onClick={() => setMode(null)} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
                  </div>
                </div>
              )}
            </>
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
                  <button type="button" onClick={() => removeExercise(i)} className="text-sm text-red-600 hover:underline">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pt-4 border-t border-stone-200">
          <label className="block text-sm font-medium text-stone-700 mb-1">Notes to client (optional)</label>
          <textarea
            value={trainerNotes}
            onChange={(e) => setTrainerNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm min-h-[80px]"
            placeholder="e.g. Focus on form today. Go heavy on set 2."
            rows={3}
          />
          <p className="text-xs text-stone-500 mt-1">The client will see this when they open the workout.</p>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={submitting || exercises.length === 0} className="px-6 py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? "Sending…" : "Send workout to client"}
          </button>
          <Link href={`/trainer/my-clients/${clientId}`} className="px-6 py-3 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium text-stone-700">Cancel</Link>
        </div>
      </form>

      {showAddExercise && (
        <>
          <div className="fixed inset-0 bg-stone-900/50 z-40" aria-hidden onClick={() => setShowAddExercise(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800 mb-4">Add exercise to database</h3>
            {newExError && <div className="mb-3 p-2 rounded-lg bg-red-50 text-red-700 text-sm">{newExError}</div>}
            <form onSubmit={handleAddExerciseToDb} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Name *</label>
                <input type="text" value={newExName} onChange={(e) => setNewExName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200" placeholder="e.g. Bench Press" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-600 mb-1">Type</label>
                <select value={newExType} onChange={(e) => setNewExType(e.target.value === "cardio" ? "cardio" : "lift")} className="w-full px-3 py-2 rounded-lg border border-stone-200">
                  <option value="lift">Lift</option>
                  <option value="cardio">Cardio</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={savingNewEx || !newExName.trim()} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">{savingNewEx ? "Saving…" : "Add exercise"}</button>
                <button type="button" onClick={() => { setShowAddExercise(false); setNewExError(null); }} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
