import DatabaseType from "better-sqlite3";
import { isTimedExerciseType, parseExerciseType, type ExerciseType } from "@/lib/exercise-types";
import { getMuscleGroup } from "@/lib/muscle-groups";
import { normalizeWorkoutNote } from "@/lib/workout-notes";

/**
 * Payload for trainer-assigned workouts (create / replace).
 * Note: `weight_kg` in `workout_sets` and in this payload stores **pounds** (lb), not kilograms —
 * the DB column name is historical; UIs label it "lbs".
 */
export type TrainerAssignedExercisePayload = {
  type: ExerciseType;
  exercise_id?: number;
  exercise_name: string;
  muscle_group?: string;
  primary_muscles?: string;
  equipment?: string;
  instructions?: string[];
  use_for_my_1rm?: boolean;
  /** Member-visible note for this exercise in this workout only. */
  notes?: string;
  sets:
    | { reps?: number; weight_kg?: number; notes?: string }[]
    | { time_seconds?: number; distance_km?: number; notes?: string }[];
};

/** Inserts workout_exercises + workout_sets for a trainer-assigned workout (caller must create the workouts row first). */
export function populateTrainerAssignedWorkoutContent(
  db: DatabaseType.Database,
  workoutId: number,
  clientMemberId: string,
  exercises: TrainerAssignedExercisePayload[]
): void {
  const getOrCreateExercise = db.prepare("SELECT id FROM exercises WHERE name = ? AND type = ? LIMIT 1");
  const getExerciseById = db.prepare("SELECT id FROM exercises WHERE id = ? LIMIT 1");
  const insertExercise = db.prepare(
    "INSERT INTO exercises (name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const weCols = db.prepare("PRAGMA table_info(workout_exercises)").all() as { name: string }[];
  const hasUseForMy1rm = weCols.some((c) => c.name === "use_for_my_1rm");
  const hasExerciseNotes = weCols.some((c) => c.name === "notes");
  const setColNames = (db.prepare("PRAGMA table_info(workout_sets)").all() as { name: string }[]).map((c) => c.name);
  const hasDropIndex = setColNames.includes("drop_index");
  const hasSetNotes = setColNames.includes("notes");

  const insertEx = hasUseForMy1rm
    ? db.prepare("INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id, use_for_my_1rm) VALUES (?, ?, ?, ?, ?, ?)")
    : db.prepare("INSERT INTO workout_exercises (workout_id, type, exercise_name, sort_order, exercise_id) VALUES (?, ?, ?, ?, ?)");

  let insertSet: DatabaseType.Statement<unknown[]>;
  if (hasDropIndex && hasSetNotes) {
    insertSet = db.prepare(
      "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
  } else if (hasDropIndex) {
    insertSet = db.prepare(
      "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, drop_index) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
  } else if (hasSetNotes) {
    insertSet = db.prepare(
      "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
  } else {
    insertSet = db.prepare(
      "INSERT INTO workout_sets (workout_exercise_id, reps, weight_kg, time_seconds, distance_km, set_order) VALUES (?, ?, ?, ?, ?, ?)"
    );
  }

  const updateExNotes = hasExerciseNotes
    ? db.prepare("UPDATE workout_exercises SET notes = ? WHERE id = ?")
    : null;

  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i] as TrainerAssignedExercisePayload;
    const type = parseExerciseType(ex.type);
    const exercise_name = String(ex.exercise_name ?? "").trim() || "Exercise";
    const primary_muscles = (ex.primary_muscles ?? "").trim() || "";
    const equipment = (ex.equipment ?? "").trim() || "";
    const muscle_group = (ex.muscle_group ?? "").trim() || getMuscleGroup(primary_muscles || undefined, exercise_name);
    const instructionsArr = Array.isArray(ex.instructions) ? ex.instructions : [];
    const instructions = instructionsArr.length > 0 ? JSON.stringify(instructionsArr.map(String)) : "";

    let exerciseId: number | null = null;
    if (typeof ex.exercise_id === "number" && ex.exercise_id > 0) {
      const row = getExerciseById.get(ex.exercise_id) as { id: number } | undefined;
      if (row) exerciseId = ex.exercise_id;
    }
    if (exerciseId == null) {
      const existing = getOrCreateExercise.get(exercise_name, type) as { id: number } | undefined;
      if (existing) {
        exerciseId = existing.id;
      } else {
        insertExercise.run(exercise_name, type, primary_muscles, "", equipment, muscle_group, instructions);
        const row = db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
        exerciseId = row.id;
      }
    }

    const useForMy1rm = !!ex.use_for_my_1rm && type === "lift" && exerciseId != null;
    const exResult = hasUseForMy1rm
      ? insertEx.run(workoutId, type, exercise_name, i, exerciseId, useForMy1rm ? 1 : 0)
      : insertEx.run(workoutId, type, exercise_name, i, exerciseId);
    const workoutExerciseId = Number(exResult.lastInsertRowid);

    if (updateExNotes != null && "notes" in ex) {
      const n =
        typeof ex.notes === "string" ? (ex.notes.trim() === "" ? null : normalizeWorkoutNote(ex.notes)) : null;
      updateExNotes.run(n, workoutExerciseId);
    }

    if (useForMy1rm) {
      db.prepare("INSERT OR REPLACE INTO member_1rm_settings (member_id, exercise_id) VALUES (?, ?)").run(clientMemberId, exerciseId);
    }
    const sets = Array.isArray(ex.sets) ? ex.sets : [];

    for (let j = 0; j < sets.length; j++) {
      const s = sets[j] ?? {};
      const reps = type === "lift" ? (typeof (s as { reps?: number }).reps === "number" ? (s as { reps: number }).reps : parseInt(String((s as { reps?: number }).reps ?? 0), 10) || null) : null;
      const weight_kg =
        type === "lift"
          ? (typeof (s as { weight_kg?: number }).weight_kg === "number"
              ? (s as { weight_kg: number }).weight_kg
              : parseFloat(String((s as { weight_kg?: number }).weight_kg ?? 0)) || null)
          : null;
      const time_seconds = isTimedExerciseType(type)
        ? (typeof (s as { time_seconds?: number }).time_seconds === "number"
            ? (s as { time_seconds: number }).time_seconds
            : parseInt(String((s as { time_seconds?: number }).time_seconds ?? 0), 10) || null)
        : null;
      const distance_km =
        type === "cardio"
          ? (typeof (s as { distance_km?: number }).distance_km === "number"
              ? (s as { distance_km: number }).distance_km
              : parseFloat(String((s as { distance_km?: number }).distance_km ?? 0)) || null)
          : null;
      const rowNotes = normalizeWorkoutNote((s as { notes?: unknown }).notes);
      if (hasDropIndex && hasSetNotes) insertSet.run(workoutExerciseId, reps, weight_kg, time_seconds, distance_km, j, 0, rowNotes);
      else if (hasDropIndex) insertSet.run(workoutExerciseId, reps, weight_kg, time_seconds, distance_km, j, 0);
      else if (hasSetNotes) insertSet.run(workoutExerciseId, reps, weight_kg, time_seconds, distance_km, j, rowNotes);
      else insertSet.run(workoutExerciseId, reps, weight_kg, time_seconds, distance_km, j);
    }
  }
}

/** Remove all exercises/sets from a workout (before replace). */
export function clearWorkoutExerciseContent(db: DatabaseType.Database, workoutId: number): void {
  db.prepare("DELETE FROM workout_sets WHERE workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)").run(workoutId);
  db.prepare("DELETE FROM workout_exercises WHERE workout_id = ?").run(workoutId);
}
