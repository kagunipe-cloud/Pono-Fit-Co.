"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { EXERCISE_TYPE_OPTIONS, type ExerciseType } from "@/lib/exercise-types";
import { MUSCLE_GROUP_LABELS } from "@/lib/muscle-groups";

type Exercise = {
  id: number;
  name: string;
  type: string;
  primary_muscles: string | null;
  secondary_muscles: string | null;
  equipment: string | null;
  muscle_group: string | null;
  instructions: string[] | string | null;
  image_path?: string | null;
};

const MUSCLE_GROUP_OPTIONS = MUSCLE_GROUP_LABELS.map((value) => ({
  value,
  label: value[0]!.toUpperCase() + value.slice(1),
}));

export default function EditExercisePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [form, setForm] = useState({
    name: "",
    type: "lift" as ExerciseType,
    primary_muscles: "",
    secondary_muscles: "",
    equipment: "",
    muscle_group: "",
    instructions: "",
  });

  useEffect(() => {
    fetch(`/api/exercises/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Exercise | null) => {
        if (data) {
          setExercise(data);
          setForm({
            name: data.name,
            type: EXERCISE_TYPE_OPTIONS.some((option) => option.value === data.type) ? (data.type as ExerciseType) : "lift",
            primary_muscles: data.primary_muscles ?? "",
            secondary_muscles: data.secondary_muscles ?? "",
            equipment: data.equipment ?? "",
            muscle_group: data.muscle_group ?? "",
            instructions: Array.isArray(data.instructions) ? data.instructions.join("\n") : data.instructions ?? "",
          });
        }
      })
      .catch(() => setExercise(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetch("/api/exercises")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Exercise[]) => setAllExercises(Array.isArray(data) ? data : []))
      .catch(() => setAllExercises([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!exercise) return;
    setError(null);
    setSaving(true);
    try {
      const instructionsText = form.instructions.trim();
      const instructions = instructionsText ? instructionsText.split("\n").map((s) => s.trim()).filter(Boolean) : [];
      const res = await fetch(`/api/exercises/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          primary_muscles: form.primary_muscles.trim() || null,
          secondary_muscles: form.secondary_muscles.trim() || null,
          equipment: form.equipment.trim() || null,
          muscle_group: form.muscle_group.trim() || null,
          instructions,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Save failed");
        return;
      }
      router.push("/exercises");
      router.refresh();
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleMerge() {
    if (!exercise || !mergeTargetId) return;
    const target = allExercises.find((ex) => String(ex.id) === mergeTargetId);
    if (!target) return;
    const confirmed = window.confirm(
      `Merge "${exercise.name}" into "${target.name}"?\n\nWorkout history, favorites, and 1RM records linked to "${exercise.name}" will move to "${target.name}", then "${exercise.name}" will be removed.`
    );
    if (!confirmed) return;

    setError(null);
    setMerging(true);
    try {
      const res = await fetch(`/api/exercises/${id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: target.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Merge failed");
        return;
      }
      router.push("/exercises");
      router.refresh();
    } catch {
      setError("Something went wrong");
    } finally {
      setMerging(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!exercise) return <div className="p-8 text-center text-stone-500">Exercise not found. <Link href="/exercises" className="text-brand-600 hover:underline">Back to exercises</Link></div>;
  const mergeCandidates = allExercises
    .filter((ex) => ex.id !== exercise.id && ex.type === form.type)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-xl mx-auto p-6">
      <Link href="/exercises" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to exercises</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Edit exercise</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {exercise.image_path && (
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Image</label>
            <Image
              src={`/api/exercises/${id}/image`}
              alt={exercise.name}
              width={320}
              height={240}
              className="max-w-xs w-full h-auto rounded-lg border border-stone-200 object-cover"
            />
          </div>
        )}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1">Name</label>
          <input
            id="name"
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
            required
          />
        </div>
        <div>
          <label htmlFor="type" className="block text-sm font-medium text-stone-700 mb-1">Type</label>
          <select
            id="type"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ExerciseType }))}
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          >
            {EXERCISE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="muscle_group" className="block text-sm font-medium text-stone-700 mb-1">Muscle group</label>
          <select
            id="muscle_group"
            value={form.muscle_group}
            onChange={(e) => setForm((f) => ({ ...f, muscle_group: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          >
            <option value="">Auto-detect from target muscle/name</option>
            {MUSCLE_GROUP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">Use one standard group so search and muscle-map suggestions stay consistent.</p>
        </div>
        <div>
          <label htmlFor="primary_muscles" className="block text-sm font-medium text-stone-700 mb-1">Primary muscles (target)</label>
          <input
            id="primary_muscles"
            type="text"
            value={form.primary_muscles}
            onChange={(e) => setForm((f) => ({ ...f, primary_muscles: e.target.value }))}
            placeholder="e.g. pectorals; triceps"
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          />
        </div>
        <div>
          <label htmlFor="secondary_muscles" className="block text-sm font-medium text-stone-700 mb-1">Secondary muscles</label>
          <input
            id="secondary_muscles"
            type="text"
            value={form.secondary_muscles}
            onChange={(e) => setForm((f) => ({ ...f, secondary_muscles: e.target.value }))}
            placeholder="e.g. deltoids"
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          />
        </div>
        <div>
          <label htmlFor="equipment" className="block text-sm font-medium text-stone-700 mb-1">Equipment</label>
          <input
            id="equipment"
            type="text"
            value={form.equipment}
            onChange={(e) => setForm((f) => ({ ...f, equipment: e.target.value }))}
            placeholder="e.g. barbell, dumbbell"
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          />
        </div>
        <div>
          <label htmlFor="instructions" className="block text-sm font-medium text-stone-700 mb-1">Instructions (one step per line)</label>
          <textarea
            id="instructions"
            value={form.instructions}
            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            placeholder="Step 1&#10;Step 2&#10;..."
            rows={6}
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Link href="/exercises" className="px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</Link>
        </div>
      </form>

      <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-semibold text-stone-800">Merge duplicate</h2>
        <p className="mt-1 text-sm text-stone-600">
          If this is the duplicate, merge it into the clean keeper. This preserves linked workout history, favorites, and 1RM records.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={mergeTargetId}
            onChange={(e) => setMergeTargetId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2"
          >
            <option value="">Choose exercise to keep...</option>
            {mergeCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleMerge}
            disabled={merging || !mergeTargetId}
            className="rounded-lg border border-amber-300 bg-white px-4 py-2 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {merging ? "Merging..." : "Merge"}
          </button>
        </div>
      </section>
    </div>
  );
}
