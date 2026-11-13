import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { parseExerciseType } from "@/lib/exercise-types";
import { getCanonicalPrimaryMuscles, getMuscleGroup } from "@/lib/muscle-groups";
import { ensureExerciseDifficultyCacheTable, loadGymPopularityMap } from "@/lib/exercise-difficulty";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

/** Member browse: exercises with gym popularity + cached web difficulty (for muscle map list). */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const type = parseExerciseType(searchParams.get("type") ?? "lift", "lift");

    const db = getDb();
    ensureWorkoutTables(db);
    ensureExerciseDifficultyCacheTable(db);

    const rows = db
      .prepare(
        `SELECT e.id, e.name, e.type, e.primary_muscles, e.secondary_muscles, e.equipment, e.muscle_group,
                e.movement_class, c.difficulty
         FROM exercises e
         LEFT JOIN exercise_difficulty_cache c ON c.exercise_id = e.id
         WHERE e.type = ?
         ORDER BY e.name`
      )
      .all(type) as {
      id: number;
      name: string;
      type: string;
      primary_muscles: string | null;
      secondary_muscles: string | null;
      equipment: string | null;
      muscle_group: string | null;
      difficulty: string | null;
    }[];

    const popularity = loadGymPopularityMap(db);
    db.close();

    const exercises = rows.map((r) => {
      const canonicalMuscles = getCanonicalPrimaryMuscles(r.name);
      const primary_muscles = canonicalMuscles ?? r.primary_muscles ?? "";
      const muscle_group =
        r.muscle_group?.trim() ? r.muscle_group : getMuscleGroup(primary_muscles, r.name);
      const pop = popularity.get(r.id);
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        primary_muscles,
        secondary_muscles: r.secondary_muscles,
        equipment: r.equipment,
        muscle_group,
        difficulty: r.difficulty,
        log_count: pop?.log_count ?? 0,
      };
    });

    return NextResponse.json({ exercises });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load exercises" }, { status: 500 });
  }
}
