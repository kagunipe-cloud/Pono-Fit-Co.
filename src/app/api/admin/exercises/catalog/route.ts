import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { getCanonicalPrimaryMuscles, getMuscleGroup } from "@/lib/muscle-groups";
import { difficultySortKey, ensureExerciseDifficultyCacheTable, loadGymPopularityMap } from "@/lib/exercise-difficulty";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

type SortMode =
  | "name"
  | "popularity_desc"
  | "popularity_asc"
  | "difficulty_asc"
  | "difficulty_desc";

/** Admin catalog with gym popularity + cached web difficulty. */
export async function GET(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const sort = (searchParams.get("sort") ?? "name") as SortMode;
    const validSort: SortMode[] = [
      "name",
      "popularity_desc",
      "popularity_asc",
      "difficulty_asc",
      "difficulty_desc",
    ];
    const sortMode = validSort.includes(sort) ? sort : "name";

    const db = getDb();
    ensureWorkoutTables(db);
    ensureExerciseDifficultyCacheTable(db);

    const rows = db
      .prepare(
        `SELECT e.id, e.name, e.type, e.primary_muscles, e.secondary_muscles, e.equipment, e.muscle_group,
                e.instructions, e.image_path, c.difficulty, c.fetched_at AS difficulty_fetched_at, c.source_note AS difficulty_note
         FROM exercises e
         LEFT JOIN exercise_difficulty_cache c ON c.exercise_id = e.id
         ORDER BY e.name`
      )
      .all() as {
      id: number;
      name: string;
      type: string;
      primary_muscles: string | null;
      secondary_muscles: string | null;
      equipment: string | null;
      muscle_group: string | null;
      instructions: string | null;
      image_path: string | null;
      difficulty: string | null;
      difficulty_fetched_at: string | null;
      difficulty_note: string | null;
    }[];

    const popularity = loadGymPopularityMap(db);
    db.close();

    const out = rows.map((r) => {
      const canonicalMuscles = getCanonicalPrimaryMuscles(r.name);
      const primary_muscles = canonicalMuscles ?? r.primary_muscles ?? "";
      const muscle_group =
        r.muscle_group?.trim() ? r.muscle_group : getMuscleGroup(primary_muscles, r.name);
      const pop = popularity.get(r.id);
      return {
        ...r,
        primary_muscles,
        muscle_group,
        log_count: pop?.log_count ?? 0,
        member_count: pop?.member_count ?? 0,
        difficulty: r.difficulty,
      };
    });

    out.sort((a, b) => {
      if (sortMode === "popularity_desc") {
        if (b.log_count !== a.log_count) return b.log_count - a.log_count;
        return a.name.localeCompare(b.name);
      }
      if (sortMode === "popularity_asc") {
        if (a.log_count !== b.log_count) return a.log_count - b.log_count;
        return a.name.localeCompare(b.name);
      }
      if (sortMode === "difficulty_asc") {
        const da = difficultySortKey(a.difficulty);
        const dbk = difficultySortKey(b.difficulty);
        if (da !== dbk) return da - dbk;
        return a.name.localeCompare(b.name);
      }
      if (sortMode === "difficulty_desc") {
        const da = difficultySortKey(a.difficulty);
        const dbk = difficultySortKey(b.difficulty);
        if (da !== dbk) return dbk - da;
        return a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ exercises: out, sort: sortMode });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load catalog" }, { status: 500 });
  }
}
