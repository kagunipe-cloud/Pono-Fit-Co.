"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { milesToKm } from "@/lib/workouts";
import { TRAINING_PHASES } from "@/lib/training-programs";

type SetRow = { reps: string; weight: string } | { time: string; distance: string };
type ExerciseEntry = {
  type: "lift" | "cardio";
  exercise_name: string;
  exercise_id?: number | null;
  sets: SetRow[];
};

export default function ProgramWorkoutEditPage() {
  const params = useParams();
  const router = useRouter();
  const programId = params.id as string;
  const workoutId = params.workoutId as string;
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("HYPERTROPHY");
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/trainer/programs/${programId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const w = (d.workouts as { id: number; name: string; training_phase: string; exercises?: unknown[] }[] | undefined)?.find(
          (x) => String(x.id) === workoutId
        );
        if (!w) {
          setError("Workout not found");
          return;
        }
        setName(w.name);
        setPhase(String(w.training_phase ?? "HYPERTROPHY").toUpperCase());
        const loaded = Array.isArray(w.exercises)
          ? w.exercises.map((raw) => {
              const x = raw as Record<string, unknown>;
              const type = x.type === "cardio" ? "cardio" : "lift";
              const setsRaw = Array.isArray(x.sets) ? x.sets : [];
              const sets: SetRow[] =
                type === "cardio"
                  ? setsRaw.map((s) => {
                      const sr = s as Record<string, unknown>;
                      const mins = sr.time_seconds != null ? Math.round(Number(sr.time_seconds) / 60) : "";
                      return { time: String(mins), distance: String(sr.distance_km ?? "") };
                    })
                  : setsRaw.map((s) => {
                      const sr = s as Record<string, unknown>;
                      return { reps: String(sr.reps ?? ""), weight: String(sr.weight_kg ?? "") };
                    });
              return {
                type,
                exercise_name: String(x.exercise_name ?? "Exercise"),
                exercise_id: typeof x.exercise_id === "number" ? x.exercise_id : undefined,
                sets: sets.length ? sets : type === "lift" ? [{ reps: "8", weight: "" }] : [{ time: "", distance: "" }],
              } as ExerciseEntry;
            })
          : [];
        setExercises(loaded);
      })
      .finally(() => setLoading(false));
  }, [programId, workoutId]);

  function addLift() {
    setExercises((e) => [...e, { type: "lift", exercise_name: "New lift", sets: [{ reps: "8", weight: "" }] }]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const exercisesPayload = exercises.map((ex) =>
      ex.type === "lift"
        ? {
            type: "lift" as const,
            exercise_id: ex.exercise_id ?? undefined,
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
              distance_km: parseFloat(s.distance) ? milesToKm(parseFloat(s.distance)) : null,
            })),
          }
    );

    const res = await fetch(`/api/trainer/programs/${programId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workouts: [
          {
            id: parseInt(workoutId, 10),
            name: name.trim() || "Workout",
            training_phase: phase,
            exercises: exercisesPayload,
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
      <p className="text-sm text-stone-500 mt-1">
        Same idea as sending a client a workout — exercises and suggested sets save into this program day. Full exercise search UI coming next; you can edit names and sets here now.
      </p>
      {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}

      <label className="block mt-4 text-sm font-medium text-stone-700">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-lg" />
      </label>
      <label className="block mt-3 text-sm font-medium text-stone-700">
        Phase
        <select value={phase} onChange={(e) => setPhase(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-lg">
          {TRAINING_PHASES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <ul className="mt-6 space-y-4">
        {exercises.map((ex, i) => (
          <li key={i} className="rounded-xl border border-stone-200 p-3">
            <input
              value={ex.exercise_name}
              onChange={(e) =>
                setExercises((list) => list.map((x, j) => (j === i ? { ...x, exercise_name: e.target.value } : x)))
              }
              className="font-medium w-full mb-2 px-2 py-1 border-b border-stone-100"
            />
            {ex.type === "lift" &&
              (ex.sets as { reps: string; weight: string }[]).map((s, si) => (
                <div key={si} className="flex gap-2 text-sm mt-1">
                  <input
                    placeholder="Reps"
                    value={s.reps}
                    onChange={(e) =>
                      setExercises((list) =>
                        list.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                sets: (x.sets as { reps: string; weight: string }[]).map((row, k) =>
                                  k === si ? { ...row, reps: e.target.value } : row
                                ),
                              }
                            : x
                        )
                      )
                    }
                    className="w-16 px-2 py-1 border rounded"
                  />
                  <input
                    placeholder="lbs"
                    value={s.weight}
                    onChange={(e) =>
                      setExercises((list) =>
                        list.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                sets: (x.sets as { reps: string; weight: string }[]).map((row, k) =>
                                  k === si ? { ...row, weight: e.target.value } : row
                                ),
                              }
                            : x
                        )
                      )
                    }
                    className="w-20 px-2 py-1 border rounded"
                  />
                </div>
              ))}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" onClick={addLift} className="px-3 py-2 rounded-lg border text-sm hover:bg-stone-50">
          + Add lift
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save workout"}
        </button>
      </div>
    </div>
  );
}