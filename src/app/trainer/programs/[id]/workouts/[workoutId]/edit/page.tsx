"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ProgramProgressionRulesEditor from "@/components/trainer/ProgramProgressionRulesEditor";
import TrainerWorkoutExerciseBuilder from "@/components/trainer/TrainerWorkoutExerciseBuilder";
import { TRAINING_PHASES } from "@/lib/training-programs";
import {
  type ExerciseEntry,
  exerciseEntriesToPayload,
  parseExerciseEntriesFromApi,
} from "@/lib/trainer-workout-builder";

export default function ProgramWorkoutEditPage() {
  const params = useParams();
  const router = useRouter();
  const programId = params.id as string;
  const workoutId = params.workoutId as string;
  const [searchMemberId, setSearchMemberId] = useState("");
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("HYPERTROPHY");
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (me?.member_id) setSearchMemberId(String(me.member_id));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch(`/api/trainer/programs/${programId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) {
          setError("Program not found");
          return;
        }
        const w = (d.workouts as { id: number; name: string; training_phase: string; exercises?: unknown[] }[] | undefined)?.find(
          (x) => String(x.id) === workoutId
        );
        if (!w) {
          setError("Workout not found");
          return;
        }
        setName(w.name);
        setPhase(String(w.training_phase ?? "HYPERTROPHY").toUpperCase());
        setExercises(Array.isArray(w.exercises) ? parseExerciseEntriesFromApi(w.exercises) : []);
      })
      .finally(() => setLoading(false));
  }, [programId, workoutId]);

  async function save() {
    if (exercises.length === 0) {
      setError("Add at least one exercise.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/trainer/programs/${programId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workouts: [
          {
            id: parseInt(workoutId, 10),
            name: name.trim() || "Workout",
            training_phase: phase,
            exercises: exerciseEntriesToPayload(exercises),
          },
        ],
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Save failed");
      return;
    }
    router.push(`/trainer/programs/${programId}`);
  }

  if (loading) return <div className="p-8 text-stone-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Link href={`/trainer/programs/${programId}`} className="text-sm text-stone-500 hover:text-stone-700">
        ← Program calendar
      </Link>
      <h1 className="text-2xl font-bold text-stone-800 mt-2">Edit program workout</h1>
      <p className="text-sm text-stone-500 mt-1">Same exercise search as sending a client a workout — builds this day&apos;s template.</p>
      {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}

      <div className="mt-4 space-y-4">
        <label className="block text-sm font-medium text-stone-700">
          Workout name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200" />
        </label>
        <label className="block text-sm font-medium text-stone-700">
          Training phase
          <select value={phase} onChange={(e) => setPhase(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200">
            {TRAINING_PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6">
        <TrainerWorkoutExerciseBuilder
          exerciseSearchMemberId={searchMemberId}
          exercises={exercises}
          onExercisesChange={setExercises}
        />
      </div>

      <ProgramProgressionRulesEditor
        programId={programId}
        programWorkoutId={workoutId}
        workoutPhase={phase}
        exercises={exercises}
      />

      <button
        type="button"
        disabled={saving || exercises.length === 0}
        onClick={() => void save()}
        className="mt-8 px-6 py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save workout template"}
      </button>
    </div>
  );
}