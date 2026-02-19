"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Exercise = {
  id: number;
  name: string;
  type: string;
  primary_muscles: string | null;
  secondary_muscles: string | null;
  equipment: string | null;
  muscle_group: string | null;
  instructions: string[];
};

export default function EditExercisePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "lift" as "lift" | "cardio",
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
            type: data.type === "cardio" ? "cardio" : "lift",
            primary_muscles: data.primary_muscles ?? "",
            secondary_muscles: data.secondary_muscles ?? "",
            equipment: data.equipment ?? "",
            muscle_group: data.muscle_group ?? "",
            instructions: Array.isArray(data.instructions) ? data.instructions.join("\n") : "",
          });
        }
      })
      .catch(() => setExercise(null))
      .finally(() => setLoading(false));
  }, [id]);

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

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!exercise) return <div className="p-8 text-center text-stone-500">Exercise not found. <Link href="/exercises" className="text-brand-600 hover:underline">Back to exercises</Link></div>;

  return (
    <div className="max-w-xl mx-auto p-6">
      <Link href="/exercises" className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to exercises</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Edit exercise</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
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
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "lift" | "cardio" }))}
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          >
            <option value="lift">Lift</option>
            <option value="cardio">Cardio</option>
          </select>
        </div>
        <div>
          <label htmlFor="muscle_group" className="block text-sm font-medium text-stone-700 mb-1">Muscle group</label>
          <input
            id="muscle_group"
            type="text"
            value={form.muscle_group}
            onChange={(e) => setForm((f) => ({ ...f, muscle_group: e.target.value }))}
            placeholder="e.g. legs, back, chest"
            className="w-full px-3 py-2 rounded-lg border border-stone-200"
          />
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
    </div>
  );
}
