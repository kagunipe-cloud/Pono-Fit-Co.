"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getWeightComparisonWithArticle } from "@/lib/workout-congrats";

type LiftSetRow = { reps: string; weight: string; drops?: { reps: string; weight: string }[] };
type CardioSetRow = { time: string; distance: string };
type SetRow = LiftSetRow | CardioSetRow;

type Exercise = {
  id: number;
  type: string;
  exercise_name: string;
  exercise_id?: number | null;
  sets: { id: number; reps: number | null; weight_kg: number | null; time_seconds: number | null; distance_km: number | null; set_order: number; drop_index?: number }[];
};
type OfficialExercise = { id: number; name: string; type: string };

type WorkoutData = {
  id: number;
  started_at: string;
  finished_at: string | null;
  source_workout_id?: number | null;
  assigned_by_admin?: number;
  name?: string | null;
  exercises: Exercise[];
};

function liftVolume(sets: Exercise["sets"]): number {
  return sets.reduce((sum, s) => sum + (s.reps ?? 0) * (s.weight_kg ?? 0), 0);
}

/** Group lift sets by set_order (each group can have 1–3 parts for drop sets). */
function groupLiftSets(sets: Exercise["sets"]): Exercise["sets"][] {
  const byOrder = new Map<number, Exercise["sets"]>();
  for (const s of sets) {
    const order = s.set_order ?? 0;
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order)!.push(s);
  }
  const orders = [...byOrder.keys()].sort((a, b) => a - b);
  return orders.map((o) => (byOrder.get(o) ?? []).sort((a, b) => (a.drop_index ?? 0) - (b.drop_index ?? 0)));
}

function totalWorkoutVolume(exercises: Exercise[]): number {
  return exercises
    .filter((e) => e.type === "lift")
    .reduce((sum, e) => sum + liftVolume(e.sets), 0);
}

export default function MemberWorkoutDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [workout, setWorkout] = useState<WorkoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"lift" | "cardio" | null>(null);
  const [exerciseName, setExerciseName] = useState("");
  const [sets, setSets] = useState<SetRow[]>([{ reps: "", weight: "", drops: [] }]);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [sourceWorkout, setSourceWorkout] = useState<WorkoutData | null>(null);
  const [repeating, setRepeating] = useState(false);
  const [addSetsForExId, setAddSetsForExId] = useState<number | null>(null);
  const [addSetsRows, setAddSetsRows] = useState<SetRow[]>([{ reps: "", weight: "", drops: [] }]);
  const [savingSets, setSavingSets] = useState(false);
  const [exerciseSuggestions, setExerciseSuggestions] = useState<OfficialExercise[]>([]);
  const [selectedOfficialId, setSelectedOfficialId] = useState<number | null>(null);
  const [showCustomNameReminder, setShowCustomNameReminder] = useState(false);
  const [instructionsModal, setInstructionsModal] = useState<{ exerciseName: string; instructions: string[] } | null>(null);
  const [loadingInstructions, setLoadingInstructions] = useState(false);
  const [editingExId, setEditingExId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"lift" | "cardio">("lift");
  const [editSets, setEditSets] = useState<SetRow[]>([{ reps: "", weight: "", drops: [] }]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingExId, setDeletingExId] = useState<number | null>(null);
  const [deletingWorkout, setDeletingWorkout] = useState(false);
  const [editingWorkoutName, setEditingWorkoutName] = useState(false);
  const [workoutNameValue, setWorkoutNameValue] = useState("");
  const [savingWorkoutName, setSavingWorkoutName] = useState(false);
  const [congratsMessage, setCongratsMessage] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [showShare, setShowShare] = useState(false);

  function fetchWorkout() {
    fetch(`/api/member/workouts/${id}`)
      .then((res) => {
        if (res.status === 401) router.replace("/login");
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(setWorkout)
      .catch(() => setWorkout(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchWorkout();
  }, [id]);

  useEffect(() => {
    if (!workout?.source_workout_id || workout.finished_at) {
      setSourceWorkout(null);
      return;
    }
    fetch(`/api/member/workouts/${workout.source_workout_id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setSourceWorkout)
      .catch(() => setSourceWorkout(null));
  }, [workout?.id, workout?.source_workout_id, workout?.finished_at]);

  function startAddLift() {
    setMode("lift");
    setExerciseName("");
    setSelectedOfficialId(null);
    setShowCustomNameReminder(false);
    setExerciseSuggestions([]);
    setSets([{ reps: "", weight: "", drops: [] }]);
  }

  function startAddCardio() {
    setMode("cardio");
    setExerciseName("");
    setSelectedOfficialId(null);
    setShowCustomNameReminder(false);
    setExerciseSuggestions([]);
    setSets([{ time: "", distance: "" }]);
  }

  useEffect(() => {
    if (!mode || !exerciseName.trim()) {
      setExerciseSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/exercises?q=${encodeURIComponent(exerciseName.trim())}&type=${mode}`)
        .then((r) => r.ok ? r.json() : [])
        .then((list: OfficialExercise[]) => setExerciseSuggestions(list))
        .catch(() => setExerciseSuggestions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [mode, exerciseName]);

  function pickOfficialExercise(ex: OfficialExercise) {
    setExerciseName(ex.name);
    setSelectedOfficialId(ex.id);
    setShowCustomNameReminder(false);
    setExerciseSuggestions([]);
  }

  function onExerciseInputBlur() {
    const match = exerciseSuggestions.find((e) => e.name.toLowerCase() === exerciseName.trim().toLowerCase());
    if (match) setSelectedOfficialId(match.id);
    else if (exerciseName.trim()) setShowCustomNameReminder(true);
  }

  function addSet() {
    if (mode === "lift") setSets((s) => [...s, { reps: "", weight: "", drops: [] }]);
    else setSets((s) => [...s, { time: "", distance: "" }]);
  }

  async function saveExercise() {
    if (!exerciseName.trim()) return;
    setSaving(true);
    try {
      const base = {
        type: mode === "lift" ? "lift" : "cardio",
        exercise_name: exerciseName.trim(),
        ...(selectedOfficialId != null && { exercise_id: selectedOfficialId }),
      };
      const body =
        mode === "lift"
          ? {
              ...base,
              sets: (sets as LiftSetRow[]).map((row) => {
                const main = { reps: parseInt(row.reps, 10) || null, weight_kg: parseFloat(row.weight) || null };
                const dropParts = (row.drops ?? []).map((d) => ({ reps: parseInt(d.reps, 10) || null, weight_kg: parseFloat(d.weight) || null }));
                return [main, ...dropParts];
              }),
            }
          : {
              ...base,
              sets: sets.map((s) => {
                const row = s as { time: string; distance: string };
                return {
                  time_seconds: parseInt(row.time, 10) ? parseInt(row.time, 10) * 60 : parseInt(row.time, 10) || null,
                  distance_km: parseFloat(row.distance) || null,
                };
              }),
            };
      const res = await fetch(`/api/member/workouts/${id}/exercises`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMode(null);
        fetchWorkout();
      } else if (res.status === 404) {
        setMode(null);
        const refetch = await fetch(`/api/member/workouts/${id}`);
        if (!refetch.ok) {
          router.push("/member/workouts");
          return;
        }
        const data = await refetch.json();
        setWorkout(data);
        alert("Workout not found. The page has been refreshed.");
      } else {
        const err = await res.json().catch(() => ({}));
        alert((err as { error?: string }).error ?? "Failed to add exercise");
      }
    } finally {
      setSaving(false);
    }
  }

  async function finishWorkout() {
    if (!workout) return;
    setFinishing(true);
    try {
      const res = await fetch(`/api/member/workouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finish: true }),
      });
      if (res.ok) {
        const volume = totalWorkoutVolume(workout.exercises);
        const phrase = volume > 0 ? getWeightComparisonWithArticle(volume) : null;
        if (phrase) {
          setCongratsMessage(phrase);
        } else {
          router.push("/member/workouts");
        }
      }
    } finally {
      setFinishing(false);
    }
  }

  async function repeatWorkout() {
    if (!workout) return;
    setRepeating(true);
    try {
      const res = await fetch("/api/member/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromWorkoutId: workout.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.id) router.push(`/member/workouts/${data.id}`);
    } finally {
      setRepeating(false);
    }
  }

  function startAddSetsFor(ex: Exercise) {
    setAddSetsForExId(ex.id);
    setAddSetsRows(ex.type === "lift" ? [{ reps: "", weight: "", drops: [] }] : [{ time: "", distance: "" }]);
  }

  function addRepeatSet(exType: string) {
    if (exType === "lift") setAddSetsRows((s) => [...s, { reps: "", weight: "", drops: [] }]);
    else setAddSetsRows((s) => [...s, { time: "", distance: "" }]);
  }

  async function saveRepeatSets() {
    if (addSetsForExId == null || !workout) return;
    const ex = workout.exercises.find((e) => e.id === addSetsForExId);
    if (!ex) return;
    setSavingSets(true);
    try {
      const body =
        ex.type === "lift"
          ? {
              sets: (addSetsRows as LiftSetRow[]).map((row) => {
                const main = { reps: parseInt(row.reps, 10) || null, weight_kg: parseFloat(row.weight) || null };
                const dropParts = (row.drops ?? []).map((d) => ({ reps: parseInt(d.reps, 10) || null, weight_kg: parseFloat(d.weight) || null }));
                return [main, ...dropParts];
              }),
            }
          : {
              sets: (addSetsRows as { time: string; distance: string }[]).map((r) => ({
                time_seconds: parseInt(r.time, 10) ? parseInt(r.time, 10) * 60 : null,
                distance_km: parseFloat(r.distance) || null,
              })),
            };
      const res = await fetch(`/api/member/workouts/${id}/exercises/${addSetsForExId}/sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAddSetsForExId(null);
        fetchWorkout();
      }
    } finally {
      setSavingSets(false);
    }
  }

  function startEditing(ex: Exercise) {
    setEditingExId(ex.id);
    setEditName(ex.exercise_name);
    const type = ex.type === "cardio" ? "cardio" : "lift";
    setEditType(type);
    if (ex.sets.length > 0) {
      setEditSets(
        type === "lift"
          ? groupLiftSets(ex.sets).map((group) => {
              const first = group[0];
              const drops = group.length > 1 ? group.slice(1).map((p) => ({ reps: String(p.reps ?? ""), weight: String(p.weight_kg ?? "") })) : [];
              return { reps: String(first?.reps ?? ""), weight: String(first?.weight_kg ?? ""), drops };
            })
          : ex.sets.map((s) => ({
              time: s.time_seconds != null ? String(Math.round(s.time_seconds / 60)) : "",
              distance: String(s.distance_km ?? ""),
            }))
      );
    } else {
      setEditSets(type === "lift" ? [{ reps: "", weight: "", drops: [] }] : [{ time: "", distance: "" }]);
    }
  }

  function addEditSet() {
    setEditSets((prev) => [...prev, editType === "lift" ? { reps: "", weight: "", drops: [] } : { time: "", distance: "" }]);
  }

  async function saveEdit() {
    if (editingExId == null) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/member/workouts/${id}/exercises/${editingExId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exercise_name: editName.trim() || "Exercise", type: editType }),
      });
      if (!res.ok) {
        setSavingEdit(false);
        return;
      }
      const setsBody =
        editType === "lift"
          ? {
              sets: (editSets as LiftSetRow[]).map((row) => {
                const main = { reps: parseInt(row.reps, 10) || null, weight_kg: parseFloat(row.weight) || null };
                const dropParts = (row.drops ?? []).map((d) => ({ reps: parseInt(d.reps, 10) || null, weight_kg: parseFloat(d.weight) || null }));
                return [main, ...dropParts];
              }),
            }
          : {
              sets: (editSets as { time: string; distance: string }[]).map((r) => ({
                time_seconds: parseInt(r.time, 10) ? parseInt(r.time, 10) * 60 : null,
                distance_km: parseFloat(r.distance) || null,
              })),
            };
      const setsRes = await fetch(`/api/member/workouts/${id}/exercises/${editingExId}/sets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setsBody),
      });
      if (setsRes.ok) {
        setEditingExId(null);
        fetchWorkout();
      }
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteWorkout() {
    if (!confirm("Delete this workout permanently? All exercises and sets will be removed. This can’t be undone.")) return;
    setDeletingWorkout(true);
    try {
      const res = await fetch(`/api/member/workouts/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/member/workouts");
    } finally {
      setDeletingWorkout(false);
    }
  }

  async function deleteExercise(exId: number) {
    if (!confirm("Remove this exercise from the workout? Its sets will be deleted too.")) return;
    setDeletingExId(exId);
    try {
      const res = await fetch(`/api/member/workouts/${id}/exercises/${exId}`, { method: "DELETE" });
      if (res.ok) {
        setEditingExId((prev) => (prev === exId ? null : prev));
        fetchWorkout();
      }
    } finally {
      setDeletingExId(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!workout) return <div className="p-8 text-center text-stone-500">Workout not found. <Link href="/member/workouts" className="text-brand-600 underline">Back to Workouts</Link></div>;

  const isOpen = !workout.finished_at;
  const isRepeatMode = isOpen && !!sourceWorkout;

  async function saveWorkoutName() {
    setSavingWorkoutName(true);
    try {
      const res = await fetch(`/api/member/workouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workoutNameValue.trim() || null }),
      });
      if (res.ok) {
        setWorkout((w) => (w ? { ...w, name: workoutNameValue.trim() || null } : w));
        setEditingWorkoutName(false);
      }
    } finally {
      setSavingWorkoutName(false);
    }
  }

  async function handleSendToMember() {
    const email = shareEmail.trim().toLowerCase();
    if (!email) return;
    setShareResult(null);
    setSharing(true);
    try {
      const res = await fetch(`/api/member/workouts/${id}/send-to-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_email: email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShareResult({ ok: true, message: (data as { message?: string }).message });
        setShareEmail("");
        setShowShare(false);
      } else {
        setShareResult({ ok: false, message: (data as { error?: string }).error ?? "Failed to send" });
      }
    } catch {
      setShareResult({ ok: false, message: "Something went wrong." });
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {editingWorkoutName ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={workoutNameValue}
                onChange={(e) => setWorkoutNameValue(e.target.value)}
                placeholder="Workout name"
                className="text-2xl font-bold text-stone-800 px-2 py-1 rounded border border-stone-300 w-64 max-w-full"
                autoFocus
              />
              <button
                type="button"
                onClick={saveWorkoutName}
                disabled={savingWorkoutName}
                className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {savingWorkoutName ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingWorkoutName(false);
                  setWorkoutNameValue(workout.name ?? "");
                }}
                className="px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 text-sm font-medium hover:bg-stone-100"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-stone-800">
                {workout.name?.trim() || (isOpen ? (isRepeatMode ? "Repeat workout" : "Workout in progress") : "Past workout")}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setWorkoutNameValue(workout.name ?? "");
                  setEditingWorkoutName(true);
                }}
                className="text-sm text-stone-500 hover:text-stone-700 hover:underline"
              >
                Edit name
              </button>
            </>
          )}
          {workout.assigned_by_admin ? (
            <span className="px-2.5 py-1 rounded-md text-sm font-medium bg-brand-100 text-brand-800">From trainer</span>
          ) : !isOpen ? (
            <span className="px-2.5 py-1 rounded-md text-sm font-medium bg-stone-100 text-stone-600">My workout</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {!isOpen && (
            <>
              <button
                type="button"
                onClick={repeatWorkout}
                disabled={repeating}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {repeating ? "Starting…" : "Repeat Workout"}
              </button>
              {!showShare ? (
                <button
                  type="button"
                  onClick={() => { setShowShare(true); setShareResult(null); }}
                  className="px-4 py-2 rounded-lg border border-stone-300 bg-white font-medium text-stone-700 hover:bg-stone-50"
                >
                  Send to a member
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    placeholder="Member's email"
                    className="px-3 py-2 rounded-lg border border-stone-200 text-sm w-44"
                    onKeyDown={(e) => e.key === "Enter" && handleSendToMember()}
                  />
                  <button
                    type="button"
                    onClick={handleSendToMember}
                    disabled={sharing}
                    className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {sharing ? "Sending…" : "Send"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowShare(false); setShareEmail(""); setShareResult(null); }}
                    className="text-stone-500 hover:text-stone-700 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {shareResult && (
                <span className={`text-sm ${shareResult.ok ? "text-stone-600" : "text-red-600"}`}>{shareResult.message}</span>
              )}
            </>
          )}
          <Link href="/member/workouts" className="text-brand-600 hover:underline text-sm">← Workouts</Link>
        </div>
      </div>

      {!mode && (
        <div className="flex flex-wrap gap-3 mb-8 items-center">
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
          {isRepeatMode && (
            <span className="text-sm text-stone-500">Fill in your sets below for each exercise.</span>
          )}
        </div>
      )}

      {mode && (
        <div className="mb-8 space-y-4">
          <div className="p-4 rounded-xl border border-stone-200 bg-stone-50">
            <h2 className="font-semibold text-stone-800 mb-3">{mode === "lift" ? "Add Lift" : "Add Cardio"}</h2>
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
              list="exercise-suggestions"
              autoComplete="off"
            />
            <datalist id="exercise-suggestions">
              {exerciseSuggestions.map((ex) => (
                <option key={ex.id} value={ex.name} />
              ))}
            </datalist>
            {exerciseSuggestions.length > 0 && (
              <ul className="mt-1 border border-stone-200 rounded-lg bg-white shadow-sm max-h-40 overflow-auto">
                {exerciseSuggestions.map((ex) => (
                  <li key={ex.id}>
                    <button
                      type="button"
                      onClick={() => pickOfficialExercise(ex)}
                      className="w-full text-left px-3 py-2 text-sm text-stone-800 hover:bg-stone-100"
                    >
                      {ex.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showCustomNameReminder && selectedOfficialId == null && exerciseName.trim() && (
              <p className="mt-1 text-xs text-stone-500">
                Using a custom name is fine — it just won&apos;t be available for progress charts. Pick one from the list above to track over time.
              </p>
            )}
          </div>

          {exerciseName.trim() && (
            <div className="p-4 rounded-xl border-2 border-stone-300 bg-white shadow-sm">
              <p className="font-semibold text-stone-800">
                {exerciseName.trim()}
                <span className="ml-2 text-xs font-normal text-stone-500 capitalize">({mode})</span>
              </p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={async () => {
                    setLoadingInstructions(true);
                    try {
                      let exerciseId = selectedOfficialId ?? null;
                      if (exerciseId == null) {
                        const searchRes = await fetch(`/api/exercises?q=${encodeURIComponent(exerciseName.trim())}&type=${mode}`);
                        if (searchRes.ok) {
                          const list = await searchRes.json();
                          const match = Array.isArray(list) && list.length > 0 ? list.find((e: { name: string }) => e.name.toLowerCase() === exerciseName.trim().toLowerCase()) ?? list[0] : null;
                          exerciseId = match?.id ?? null;
                        }
                      }
                      if (exerciseId != null) {
                        const res = await fetch(`/api/exercises/${exerciseId}`);
                        if (res.ok) {
                          const data = await res.json();
                          setInstructionsModal({ exerciseName: data.name ?? exerciseName.trim(), instructions: Array.isArray(data.instructions) ? data.instructions : [] });
                          return;
                        }
                      }
                      setInstructionsModal({ exerciseName: exerciseName.trim(), instructions: [] });
                    } finally {
                      setLoadingInstructions(false);
                    }
                  }}
                  disabled={loadingInstructions}
                  className="text-sm text-brand-600 hover:underline disabled:opacity-50"
                >
                  {loadingInstructions ? "Loading…" : "Need Instructions?"}
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {mode === "lift" ? (
                  (sets as LiftSetRow[]).map((row, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-stone-500 w-10">Set {i + 1}</span>
                      <input
                        type="text"
                        placeholder="Reps"
                        value={row.reps}
                        onChange={(e) =>
                          setSets((s) =>
                            s.map((row, ri) => (ri === i ? { ...(row as LiftSetRow), reps: e.target.value } : row))
                          )
                        }
                        className="w-20 px-2 py-1.5 rounded border border-stone-200"
                      />
                      <input
                        type="text"
                        placeholder="Weight (lbs)"
                        value={row.weight}
                        onChange={(e) =>
                          setSets((s) =>
                            s.map((row, ri) => (ri === i ? { ...(row as LiftSetRow), weight: e.target.value } : row))
                          )
                        }
                        className="w-24 px-2 py-1.5 rounded border border-stone-200"
                      />
                      {(row.drops ?? []).map((drop, di) => (
                        <span key={di} className="flex items-center gap-1">
                          <span className="text-stone-400">↓</span>
                          <input
                            type="text"
                            placeholder="Reps"
                            value={drop.reps}
                            onChange={(e) =>
                              setSets((s) =>
                                s.map((row, ri) => {
                                  if (ri !== i) return row;
                                  const r = row as LiftSetRow;
                                  const drops = [...(r.drops ?? [])];
                                  drops[di] = { ...drops[di]!, reps: e.target.value };
                                  return { ...r, drops };
                                })
                              )
                            }
                            className="w-16 px-2 py-1.5 rounded border border-stone-200 text-sm"
                          />
                          <input
                            type="text"
                            placeholder="lbs"
                            value={drop.weight}
                            onChange={(e) =>
                              setSets((s) =>
                                s.map((row, ri) => {
                                  if (ri !== i) return row;
                                  const r = row as LiftSetRow;
                                  const drops = [...(r.drops ?? [])];
                                  drops[di] = { ...drops[di]!, weight: e.target.value };
                                  return { ...r, drops };
                                })
                              )
                            }
                            className="w-16 px-2 py-1.5 rounded border border-stone-200 text-sm"
                          />
                        </span>
                      ))}
                      {(row.drops?.length ?? 0) < 2 && (
                        <button
                          type="button"
                          onClick={() =>
                            setSets((s) =>
                              s.map((row, ri) => {
                                if (ri !== i) return row;
                                const r = row as LiftSetRow;
                                return { ...r, drops: [...(r.drops ?? []), { reps: "", weight: "" }] };
                              })
                            )
                          }
                          className="text-xs text-brand-600 hover:underline"
                        >
                          Add dropset
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  (sets as { time: string; distance: string }[]).map((row, i) => (
                    <div key={i} className="flex gap-2 flex-wrap items-center">
                      <span className="text-sm text-stone-500 w-10">Set {i + 1}</span>
                      <input
                        type="text"
                        placeholder="Time (min)"
                        value={row.time}
                        onChange={(e) =>
                          setSets((s) => {
                            const next = [...s];
                            (next[i] as { time: string; distance: string }).time = e.target.value;
                            return next;
                          })
                        }
                        className="w-24 px-2 py-1.5 rounded border border-stone-200"
                      />
                      <input
                        type="text"
                        placeholder="Distance (km)"
                        value={row.distance}
                        onChange={(e) =>
                          setSets((s) => {
                            const next = [...s];
                            (next[i] as { time: string; distance: string }).distance = e.target.value;
                            return next;
                          })
                        }
                        className="w-24 px-2 py-1.5 rounded border border-stone-200"
                      />
                    </div>
                  ))
                )}
              </div>
              {mode === "cardio" && (
                <p className="mt-1 text-xs text-stone-500">Time in minutes; distance in km.</p>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  type="button"
                  onClick={saveExercise}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Add to workout"}
                </button>
                <button
                  type="button"
                  onClick={addSet}
                  className="px-4 py-2 rounded-lg border border-stone-200 bg-stone-50 font-medium hover:bg-stone-100"
                >
                  Add Set
                </button>
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <h2 className="text-sm font-medium text-stone-500 mb-2">{isOpen ? "Open Workout" : "Exercises"}</h2>
      {workout.exercises.length === 0 ? (
        <p className="text-stone-500 mb-6">No exercises yet. Add a lift or cardio above.</p>
      ) : (
        <>
          {totalWorkoutVolume(workout.exercises) > 0 && (
            <p className="mb-3 text-sm font-medium text-stone-700">
              Total volume: <span className="text-brand-600">{totalWorkoutVolume(workout.exercises).toLocaleString()} lbs</span>
            </p>
          )}
          <ul className="space-y-4 mb-8">
            {workout.exercises.map((ex, exIndex) => {
              const vol = ex.type === "lift" ? liftVolume(ex.sets) : 0;
              const lastTimeSets = isRepeatMode && sourceWorkout?.exercises[exIndex]?.sets;
              const isAddingSets = addSetsForExId === ex.id;
              return (
                <li key={ex.id} className="p-4 rounded-xl border border-stone-200 bg-white">
                  {editingExId === ex.id ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-stone-200 text-stone-800"
                        placeholder="Exercise name"
                      />
                      <select
                        value={editType}
                        onChange={(e) => {
                          const newType = e.target.value === "cardio" ? "cardio" : "lift";
                          setEditType(newType);
                          setEditSets(newType === "lift" ? [{ reps: "", weight: "", drops: [] }] : [{ time: "", distance: "" }]);
                        }}
                        className="px-3 py-2 rounded-lg border border-stone-200 text-stone-800"
                      >
                        <option value="lift">Lift</option>
                        <option value="cardio">Cardio</option>
                      </select>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">Sets</p>
                        {editType === "lift"
                          ? (editSets as LiftSetRow[]).map((row, i) => (
                              <div key={i} className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-stone-500 w-10">Set {i + 1}</span>
                                <input
                                  type="text"
                                  placeholder="Reps"
                                  value={row.reps}
                                  onChange={(e) =>
                                    setEditSets((s) =>
                                      s.map((r, ri) => (ri === i ? { ...(r as LiftSetRow), reps: e.target.value } : r))
                                    )
                                  }
                                  className="w-20 px-2 py-1.5 rounded border border-stone-200"
                                />
                                <input
                                  type="text"
                                  placeholder="Weight (lbs)"
                                  value={row.weight}
                                  onChange={(e) =>
                                    setEditSets((s) =>
                                      s.map((r, ri) => (ri === i ? { ...(r as LiftSetRow), weight: e.target.value } : r))
                                    )
                                  }
                                  className="w-24 px-2 py-1.5 rounded border border-stone-200"
                                />
                                {(row.drops ?? []).map((drop, di) => (
                                  <span key={di} className="flex items-center gap-1">
                                    <span className="text-stone-400">↓</span>
                                    <input
                                      type="text"
                                      placeholder="Reps"
                                      value={drop.reps}
                                      onChange={(e) =>
                                        setEditSets((s) =>
                                          s.map((r, ri) => {
                                            if (ri !== i) return r;
                                            const row = r as LiftSetRow;
                                            const drops = [...(row.drops ?? [])];
                                            drops[di] = { ...drops[di]!, reps: e.target.value };
                                            return { ...row, drops };
                                          })
                                        )
                                      }
                                      className="w-16 px-2 py-1.5 rounded border border-stone-200 text-sm"
                                    />
                                    <input
                                      type="text"
                                      placeholder="lbs"
                                      value={drop.weight}
                                      onChange={(e) =>
                                        setEditSets((s) =>
                                          s.map((r, ri) => {
                                            if (ri !== i) return r;
                                            const row = r as LiftSetRow;
                                            const drops = [...(row.drops ?? [])];
                                            drops[di] = { ...drops[di]!, weight: e.target.value };
                                            return { ...row, drops };
                                          })
                                        )
                                      }
                                      className="w-16 px-2 py-1.5 rounded border border-stone-200 text-sm"
                                    />
                                  </span>
                                ))}
                                {(row.drops?.length ?? 0) < 2 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditSets((s) =>
                                        s.map((r, ri) =>
                                          ri === i ? { ...(r as LiftSetRow), drops: [...((r as LiftSetRow).drops ?? []), { reps: "", weight: "" }] } : r
                                        )
                                      )
                                    }
                                    className="text-xs text-brand-600 hover:underline"
                                  >
                                    Add dropset
                                  </button>
                                )}
                              </div>
                            ))
                          : (editSets as { time: string; distance: string }[]).map((row, i) => (
                              <div key={i} className="flex gap-2 flex-wrap items-center">
                                <span className="text-sm text-stone-500 w-10">Set {i + 1}</span>
                                <input
                                  type="text"
                                  placeholder="Time (min)"
                                  value={row.time}
                                  onChange={(e) =>
                                    setEditSets((s) => {
                                      const next = [...s];
                                      (next[i] as { time: string; distance: string }).time = e.target.value;
                                      return next;
                                    })
                                  }
                                  className="w-24 px-2 py-1.5 rounded border border-stone-200"
                                />
                                <input
                                  type="text"
                                  placeholder="Distance (km)"
                                  value={row.distance}
                                  onChange={(e) =>
                                    setEditSets((s) => {
                                      const next = [...s];
                                      (next[i] as { time: string; distance: string }).distance = e.target.value;
                                      return next;
                                    })
                                  }
                                  className="w-24 px-2 py-1.5 rounded border border-stone-200"
                                />
                              </div>
                            ))}
                        <button
                          type="button"
                          onClick={addEditSet}
                          className="text-sm text-stone-600 hover:underline"
                        >
                          Add set
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={savingEdit}
                          className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                        >
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingExId(null)}
                          className="px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 text-sm hover:bg-stone-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="font-medium text-stone-800">
                        {ex.exercise_name}
                        <span className="ml-2 text-xs font-normal text-stone-500 capitalize">({ex.type})</span>
                        {vol > 0 && (
                          <span className="ml-2 text-xs font-medium text-brand-600">
                            {vol.toLocaleString()} lbs volume
                          </span>
                        )}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <button
                          type="button"
                          onClick={async () => {
                            setLoadingInstructions(true);
                            try {
                              let exerciseId = ex.exercise_id ?? null;
                              if (exerciseId == null) {
                                const searchRes = await fetch(`/api/exercises?q=${encodeURIComponent(ex.exercise_name)}&type=${ex.type}`);
                                if (searchRes.ok) {
                                  const list = await searchRes.json();
                                  const match = Array.isArray(list) && list.length > 0 ? list.find((e: { name: string }) => e.name.toLowerCase() === ex.exercise_name.toLowerCase()) ?? list[0] : null;
                                  exerciseId = match?.id ?? null;
                                }
                              }
                              if (exerciseId != null) {
                                const res = await fetch(`/api/exercises/${exerciseId}`);
                                if (res.ok) {
                                  const data = await res.json();
                                  setInstructionsModal({ exerciseName: data.name ?? ex.exercise_name, instructions: Array.isArray(data.instructions) ? data.instructions : [] });
                                  return;
                                }
                              }
                              setInstructionsModal({ exerciseName: ex.exercise_name, instructions: [] });
                            } finally {
                              setLoadingInstructions(false);
                            }
                          }}
                          disabled={loadingInstructions}
                          className="text-sm text-brand-600 hover:underline disabled:opacity-50"
                        >
                          {loadingInstructions ? "Loading…" : "Need Instructions?"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditing(ex)}
                          className="text-sm text-stone-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteExercise(ex.id)}
                          disabled={deletingExId === ex.id}
                          className="text-sm text-red-600 hover:underline disabled:opacity-50"
                        >
                          {deletingExId === ex.id ? "Removing…" : "Delete"}
                        </button>
                      </div>
                    </>
                  )}
                  {editingExId !== ex.id && isRepeatMode && lastTimeSets && lastTimeSets.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">Last time</p>
                      <ul className="mt-0.5 space-y-0.5 text-sm text-stone-600">
                        {ex.type === "lift"
                          ? groupLiftSets(lastTimeSets as Exercise["sets"]).map((group, i) => (
                              <li key={i}>
                                Set {i + 1}: {group.map((s, j) => (
                                  <span key={j}>
                                    {j > 0 && " ↓ "}
                                    {s.reps ?? "—"} reps, {s.weight_kg != null ? s.weight_kg + " lbs" : "—"}
                                  </span>
                                ))}
                              </li>
                            ))
                          : (lastTimeSets as Exercise["sets"]).map((s: Exercise["sets"][0], i: number) => (
                              <li key={i}>
                                Set {i + 1}: {s.time_seconds != null ? Math.round(s.time_seconds / 60) + " min" : "—"}
                                {s.distance_km != null ? ", " + s.distance_km + " km" : ""}
                              </li>
                            ))}
                      </ul>
                    </div>
                  )}
                  {editingExId !== ex.id && (
                  <div className="mt-2">
                    {isRepeatMode && <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">This time</p>}
                    {ex.sets.length > 0 ? (
                      <ul className="mt-0.5 space-y-0.5 text-sm text-stone-600">
                        {ex.type === "lift"
                          ? groupLiftSets(ex.sets).map((group, i) => (
                              <li key={i}>
                                Set {i + 1}: {group.map((s, j) => (
                                  <span key={s.id ?? j}>
                                    {j > 0 && " ↓ "}
                                    {s.reps ?? "—"} reps, {s.weight_kg != null ? s.weight_kg + " lbs" : "—"}
                                  </span>
                                ))}
                              </li>
                            ))
                          : ex.sets.map((s, i) => (
                              <li key={s.id}>
                                Set {i + 1}: {s.time_seconds != null ? Math.round(s.time_seconds / 60) + " min" : "—"}
                                {s.distance_km != null ? ", " + s.distance_km + " km" : ""}
                              </li>
                            ))}
                      </ul>
                    ) : isRepeatMode && !isAddingSets && (
                      <p className="mt-0.5 text-sm text-stone-400">No sets logged yet.</p>
                    )}
                    {((isOpen && isRepeatMode) || !isOpen) && (
                      isAddingSets ? (
                        <div className="mt-3 space-y-2">
                          {ex.type === "lift"
                            ? (addSetsRows as LiftSetRow[]).map((row, i) => (
                                <div key={i} className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm text-stone-500 w-8">Set {i + 1}</span>
                                  <input
                                    type="text"
                                    placeholder="Reps"
                                    value={row.reps}
                                    onChange={(e) =>
                                      setAddSetsRows((s) =>
                                        s.map((r, ri) => (ri === i ? { ...(r as LiftSetRow), reps: e.target.value } : r))
                                      )
                                    }
                                    className="w-20 px-2 py-1.5 rounded border border-stone-200"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Weight (lbs)"
                                    value={row.weight}
                                    onChange={(e) =>
                                      setAddSetsRows((s) =>
                                        s.map((r, ri) => (ri === i ? { ...(r as LiftSetRow), weight: e.target.value } : r))
                                      )
                                    }
                                    className="w-24 px-2 py-1.5 rounded border border-stone-200"
                                  />
                                  {(row.drops ?? []).map((drop, di) => (
                                    <span key={di} className="flex items-center gap-1">
                                      <span className="text-stone-400">↓</span>
                                      <input
                                        type="text"
                                        placeholder="Reps"
                                        value={drop.reps}
                                        onChange={(e) =>
                                          setAddSetsRows((s) =>
                                            s.map((r, ri) => {
                                              if (ri !== i) return r;
                                              const row = r as LiftSetRow;
                                              const drops = [...(row.drops ?? [])];
                                              drops[di] = { ...drops[di]!, reps: e.target.value };
                                              return { ...row, drops };
                                            })
                                          )
                                        }
                                        className="w-16 px-2 py-1.5 rounded border border-stone-200 text-sm"
                                      />
                                      <input
                                        type="text"
                                        placeholder="lbs"
                                        value={drop.weight}
                                        onChange={(e) =>
                                          setAddSetsRows((s) =>
                                            s.map((r, ri) => {
                                              if (ri !== i) return r;
                                              const row = r as LiftSetRow;
                                              const drops = [...(row.drops ?? [])];
                                              drops[di] = { ...drops[di]!, weight: e.target.value };
                                              return { ...row, drops };
                                            })
                                          )
                                        }
                                        className="w-16 px-2 py-1.5 rounded border border-stone-200 text-sm"
                                      />
                                    </span>
                                  ))}
                                  {(row.drops?.length ?? 0) < 2 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setAddSetsRows((s) =>
                                          s.map((r, ri) =>
                                            ri === i ? { ...(r as LiftSetRow), drops: [...((r as LiftSetRow).drops ?? []), { reps: "", weight: "" }] } : r
                                          )
                                        )
                                      }
                                      className="text-xs text-brand-600 hover:underline"
                                    >
                                      Add dropset
                                    </button>
                                  )}
                                </div>
                              ))
                            : (addSetsRows as { time: string; distance: string }[]).map((row, i) => (
                                <div key={i} className="flex gap-2 flex-wrap items-center">
                                  <span className="text-sm text-stone-500 w-8">Set {i + 1}</span>
                                  <input
                                    type="text"
                                    placeholder="Time (min)"
                                    value={row.time}
                                    onChange={(e) => {
                                      const next = [...addSetsRows];
                                      (next[i] as { time: string; distance: string }).time = e.target.value;
                                      setAddSetsRows(next);
                                    }}
                                    className="w-24 px-2 py-1.5 rounded border border-stone-200"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Distance (km)"
                                    value={row.distance}
                                    onChange={(e) => {
                                      const next = [...addSetsRows];
                                      (next[i] as { time: string; distance: string }).distance = e.target.value;
                                      setAddSetsRows(next);
                                    }}
                                    className="w-24 px-2 py-1.5 rounded border border-stone-200"
                                  />
                                </div>
                              ))}
                          <div className="flex gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={saveRepeatSets}
                              disabled={savingSets}
                              className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                            >
                              {savingSets ? "Saving…" : "Save sets"}
                            </button>
                            <button
                              type="button"
                              onClick={() => addRepeatSet(ex.type)}
                              className="px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm font-medium hover:bg-stone-50"
                            >
                              Add set
                            </button>
                            <button
                              type="button"
                              onClick={() => setAddSetsForExId(null)}
                              className="px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 text-sm hover:bg-stone-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startAddSetsFor(ex)}
                          className="mt-2 px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-sm font-medium text-stone-700 hover:bg-stone-100"
                        >
                          {ex.sets.length > 0 ? "Add more sets" : "Log sets"}
                        </button>
                      )
                    )}
                  </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {isOpen && (
        <div className="pt-4 border-t border-stone-200">
          <button
            type="button"
            onClick={finishWorkout}
            disabled={finishing}
            className="w-full sm:w-auto px-6 py-3 rounded-lg bg-stone-800 text-white font-medium hover:bg-stone-900 disabled:opacity-50"
          >
            {finishing ? "Saving…" : "Finish Workout"}
          </button>
          <p className="mt-2 text-sm text-stone-500">This will save the workout to your past workouts and return you to the list.</p>
        </div>
      )}

      <div className="pt-4 mt-4 border-t border-stone-200">
        <button
          type="button"
          onClick={deleteWorkout}
          disabled={deletingWorkout}
          className="px-4 py-2 rounded-lg border border-red-200 text-red-700 font-medium hover:bg-red-50 disabled:opacity-50"
        >
          {deletingWorkout ? "Deleting…" : "Delete workout"}
        </button>
        <p className="mt-1 text-xs text-stone-500">Permanently remove this workout. Cannot be undone.</p>
      </div>

      {congratsMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="congrats-title"
        >
          <div
            className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="congrats-title" className="text-xl font-semibold text-stone-800 mb-2">
              Workout saved!
            </h2>
            <p className="text-stone-600 mb-6">
              Congrats — today you lifted <span className="font-semibold text-brand-700">{congratsMessage}</span>!
            </p>
            <button
              type="button"
              onClick={() => {
                setCongratsMessage(null);
                router.push("/member/workouts");
              }}
              className="w-full px-4 py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
            >
              Back to workouts
            </button>
          </div>
        </div>
      )}

      {instructionsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setInstructionsModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="instructions-title"
        >
          <div
            className="bg-white rounded-xl shadow-lg max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-stone-200 flex items-center justify-between">
              <h2 id="instructions-title" className="font-semibold text-stone-800">Instructions for {instructionsModal.exerciseName}</h2>
              <button
                type="button"
                onClick={() => setInstructionsModal(null)}
                className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {instructionsModal.instructions.length === 0 ? (
                <p className="text-stone-500 text-sm">No instructions available for this exercise.</p>
              ) : (
                <ol className="list-decimal list-inside space-y-2 text-sm text-stone-700">
                  {instructionsModal.instructions.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
            <div className="p-4 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setInstructionsModal(null)}
                className="w-full px-4 py-2 rounded-lg bg-stone-200 text-stone-800 font-medium hover:bg-stone-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
