import { milesToKm } from "@/lib/workouts";
import type { TrainerAssignedExercisePayload } from "@/lib/trainer-assigned-workout-content";

export type SetRow = { reps: string; weight: string } | { time: string; distance: string };

export type ExerciseEntry = {
  type: "lift" | "cardio";
  exercise_name: string;
  exercise_id?: number | null;
  muscle_group?: string;
  primary_muscles?: string;
  equipment?: string;
  instructions?: string;
  use_for_my_1rm?: boolean;
  sets: SetRow[];
};

export type OfficialExercise = {
  id: number;
  name: string;
  type: string;
  primary_muscles?: string;
  muscle_group?: string;
  equipment?: string;
};

export function exerciseEntriesToPayload(exercises: ExerciseEntry[]): TrainerAssignedExercisePayload[] {
  return exercises.map((ex) =>
    ex.type === "lift"
      ? {
          type: "lift" as const,
          exercise_id: ex.exercise_id ?? undefined,
          exercise_name: ex.exercise_name,
          use_for_my_1rm: ex.use_for_my_1rm,
          muscle_group: ex.muscle_group,
          primary_muscles: ex.primary_muscles,
          equipment: ex.equipment,
          instructions: ex.instructions ? ex.instructions.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
          sets: (ex.sets as { reps: string; weight: string }[]).map((s) => {
            const reps = parseInt(s.reps, 10);
            const w = parseFloat(s.weight);
            return {
              reps: Number.isFinite(reps) ? reps : undefined,
              weight_kg: Number.isFinite(w) ? w : undefined,
            };
          }),
        }
      : {
          type: "cardio" as const,
          exercise_id: ex.exercise_id ?? undefined,
          exercise_name: ex.exercise_name,
          use_for_my_1rm: false,
          muscle_group: ex.muscle_group,
          primary_muscles: ex.primary_muscles,
          equipment: ex.equipment,
          instructions: ex.instructions ? ex.instructions.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
          sets: (ex.sets as { time: string; distance: string }[]).map((s) => {
            const mins = parseInt(s.time, 10);
            const dist = parseFloat(s.distance);
            return {
              time_seconds: Number.isFinite(mins) && mins > 0 ? mins * 60 : undefined,
              distance_km: Number.isFinite(dist) && dist > 0 ? milesToKm(dist) : undefined,
            };
          }),
        }
  );
}

/** Load exercises from API / template JSON into form rows. */
export function parseExerciseEntriesFromApi(raw: unknown[]): ExerciseEntry[] {
  return raw.map((item) => {
    const x = item as Record<string, unknown>;
    const type = x.type === "cardio" ? "cardio" : "lift";
    const setsRaw = Array.isArray(x.sets) ? x.sets : [];
    const sets: SetRow[] =
      type === "cardio"
        ? setsRaw.map((s) => {
            const sr = s as Record<string, unknown>;
            const mins =
              sr.time != null
                ? String(sr.time)
                : sr.time_seconds != null
                  ? String(Math.round(Number(sr.time_seconds) / 60))
                  : "";
            const dist =
              sr.distance != null
                ? String(sr.distance)
                : sr.distance_km != null
                  ? String(sr.distance_km)
                  : "";
            return { time: mins, distance: dist };
          })
        : setsRaw.map((s) => {
            const sr = s as Record<string, unknown>;
            return {
              reps: String(sr.reps ?? ""),
              weight: String(sr.weight ?? sr.weight_kg ?? ""),
            };
          });
    const instructions = Array.isArray(x.instructions)
      ? (x.instructions as string[]).join("\n")
      : typeof x.instructions === "string"
        ? x.instructions
        : undefined;
    return {
      type,
      exercise_name: String(x.exercise_name ?? ""),
      exercise_id: typeof x.exercise_id === "number" ? x.exercise_id : undefined,
      muscle_group: typeof x.muscle_group === "string" ? x.muscle_group : undefined,
      primary_muscles: typeof x.primary_muscles === "string" ? x.primary_muscles : undefined,
      equipment: typeof x.equipment === "string" ? x.equipment : undefined,
      instructions,
      use_for_my_1rm: !!x.use_for_my_1rm,
      sets:
        sets.length > 0
          ? sets
          : type === "lift"
            ? [{ reps: "", weight: "" }]
            : [{ time: "", distance: "" }],
    };
  });
}