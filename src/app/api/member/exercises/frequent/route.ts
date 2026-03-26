import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { exerciseSearchScore, type ExerciseStat } from "@/lib/exercise-search-rank";
import { getMemberIdFromSession } from "@/lib/session";
import { getCanonicalPrimaryMuscles, getMuscleGroup } from "@/lib/muscle-groups";
import { canAccessMemberExerciseStats } from "@/lib/member-exercise-access";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/**
 * GET ?type=lift|cardio&limit=15&for_member_id=...
 * Exercises this member has logged often, plus pinned favorites, ranked by favorites + frequency + recency.
 * for_member_id: trainer/admin may pass a client member_id (must be allowed).
 */
export async function GET(request: NextRequest) {
  try {
    const sessionMemberId = await getMemberIdFromSession();
    if (!sessionMemberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const limit = Math.min(25, Math.max(1, parseInt(searchParams.get("limit") ?? "15", 10) || 15));
    const forMemberParam = searchParams.get("for_member_id")?.trim() || null;

    if (type !== "lift" && type !== "cardio") {
      return NextResponse.json({ error: "type=lift or type=cardio required" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    let targetMemberId = sessionMemberId;
    if (forMemberParam && forMemberParam !== sessionMemberId) {
      if (!canAccessMemberExerciseStats(db, sessionMemberId, forMemberParam)) {
        db.close();
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      targetMemberId = forMemberParam;
    }

    const favRows = db
      .prepare(
        `SELECT f.exercise_id FROM member_exercise_favorites f
         JOIN exercises e ON e.id = f.exercise_id
         WHERE f.member_id = ? AND e.type = ?`
      )
      .all(targetMemberId, type) as { exercise_id: number }[];
    const favoriteIds = new Set(favRows.map((r) => r.exercise_id));

    const freqRows = db
      .prepare(
        `SELECT we.exercise_id, COUNT(*) AS c, MAX(w.started_at) AS last_used
         FROM workout_exercises we
         JOIN workouts w ON w.id = we.workout_id
         WHERE w.member_id = ? AND we.exercise_id IS NOT NULL AND we.type = ?
         GROUP BY we.exercise_id
         ORDER BY c DESC, last_used DESC
         LIMIT 120`
      )
      .all(targetMemberId, type) as { exercise_id: number; c: number; last_used: string }[];

    const statsMap = new Map<number, ExerciseStat>();
    for (const fr of freqRows) {
      statsMap.set(fr.exercise_id, { count: fr.c, lastUsed: fr.last_used });
    }
    for (const fid of favoriteIds) {
      if (!statsMap.has(fid)) statsMap.set(fid, { count: 0, lastUsed: null });
    }

    const idSet = new Set<number>([...favoriteIds, ...freqRows.map((r) => r.exercise_id)]);
    if (idSet.size === 0) {
      db.close();
      return NextResponse.json({ exercises: [] });
    }

    const ids = [...idSet];
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions, image_path
         FROM exercises WHERE id IN (${placeholders}) AND type = ?`
      )
      .all(...ids, type) as {
      id: number;
      name: string;
      type: string;
      primary_muscles?: string | null;
      secondary_muscles?: string | null;
      equipment?: string | null;
      muscle_group?: string | null;
      instructions?: string | null;
      image_path?: string | null;
    }[];

    db.close();

    const sorted = [...rows].sort((a, b) => {
      const sa = exerciseSearchScore(a.name, "", a.id, statsMap, favoriteIds);
      const sb = exerciseSearchScore(b.name, "", b.id, statsMap, favoriteIds);
      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name);
    });

    const exercises = sorted.slice(0, limit).map((r) => {
      const canonicalMuscles = getCanonicalPrimaryMuscles(r.name);
      const primary_muscles = canonicalMuscles ?? r.primary_muscles ?? "";
      const muscle_group =
        r.muscle_group && r.muscle_group.trim()
          ? r.muscle_group
          : getMuscleGroup(primary_muscles, r.name);
      return { ...r, primary_muscles, muscle_group };
    });

    return NextResponse.json({ exercises });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load frequent exercises" }, { status: 500 });
  }
}
