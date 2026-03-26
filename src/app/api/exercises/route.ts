import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { blendRankedWithNeverTried, exerciseSearchScore, type ExerciseStat } from "@/lib/exercise-search-rank";
import { getCanonicalPrimaryMuscles, getMuscleGroup } from "@/lib/muscle-groups";
import { canAccessMemberExerciseStats } from "@/lib/member-exercise-access";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** GET ?q=...&type=lift|cardio&boost_member=1&boost_for_member_id=... — search/autocomplete. boost_member=1 ranks by favorites, frequency, recency, and name match; blends in never-tried matches so results stay discoverable. boost_for_member_id lets trainers rank by a client's history (must be allowed). */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    const type = searchParams.get("type"); // 'lift' | 'cardio' | omit for both
    const boostMember = searchParams.get("boost_member") === "1";
    const boostForMemberIdParam = searchParams.get("boost_for_member_id")?.trim() || null;

    const db = getDb();
    ensureWorkoutTables(db);

    const sessionMemberId = await getMemberIdFromSession();
    let boostTargetId: string | null = null;
    if (boostMember && q.length > 0 && (type === "lift" || type === "cardio") && sessionMemberId) {
      if (boostForMemberIdParam && boostForMemberIdParam !== sessionMemberId) {
        if (canAccessMemberExerciseStats(db, sessionMemberId, boostForMemberIdParam)) {
          boostTargetId = boostForMemberIdParam;
        }
      } else {
        boostTargetId = sessionMemberId;
      }
    }

    let sql = "SELECT id, name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions, image_path FROM exercises WHERE 1=1";
    const params: (string | number)[] = [];
    if (type === "lift" || type === "cardio") {
      sql += " AND type = ?";
      params.push(type);
    }
    if (q.length > 0) {
      sql += " AND name LIKE ?";
      params.push(`%${q}%`);
    }
    const poolLimit = q.length > 0 ? 250 : 10000;
    sql += " ORDER BY name LIMIT " + poolLimit;

    const rows = db.prepare(sql).all(...params) as {
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

    const statsMap = new Map<number, ExerciseStat>();
    const favoriteIds = new Set<number>();
    if (boostTargetId && (type === "lift" || type === "cardio")) {
      const freqRows = db
        .prepare(
          `SELECT we.exercise_id, COUNT(*) AS c, MAX(w.started_at) AS last_used
           FROM workout_exercises we
           JOIN workouts w ON w.id = we.workout_id
           WHERE w.member_id = ? AND we.exercise_id IS NOT NULL AND we.type = ?
           GROUP BY we.exercise_id`
        )
        .all(boostTargetId, type) as { exercise_id: number; c: number; last_used: string | null }[];
      for (const fr of freqRows) {
        statsMap.set(fr.exercise_id, { count: fr.c, lastUsed: fr.last_used });
      }
      const favRows = db.prepare("SELECT exercise_id FROM member_exercise_favorites WHERE member_id = ?").all(boostTargetId) as { exercise_id: number }[];
      for (const fr of favRows) favoriteIds.add(fr.exercise_id);
    }

    db.close();

    // Deduplicate only when searching (member autocomplete); admin list shows all exercises.
    let rowsToUse = rows;
    if (q.length > 0) {
      const normalized = (s: string) => s.trim().toLowerCase();
      const sortedByLength = [...rows].sort((a, b) => normalized(a.name).length - normalized(b.name).length);
      const deduped: typeof rows = [];
      for (const r of sortedByLength) {
        const n = normalized(r.name);
        const isDuplicate = deduped.some((d) => {
          const dn = normalized(d.name);
          if (d.type !== r.type) return false;
          if (n === dn) return true;
          if (n.includes(dn) || dn.includes(n)) return true;
          return false;
        });
        if (!isDuplicate) deduped.push(r);
      }
      rowsToUse = deduped.length > 0 ? deduped : rows;
    }

    // Derive muscle_group for rows that don't have it; apply name-based overrides (e.g. Bulgarian split squat = legs)
    const out = rowsToUse.map((r) => {
      const canonicalMuscles = getCanonicalPrimaryMuscles(r.name);
      const primary_muscles = canonicalMuscles ?? r.primary_muscles ?? "";
      const muscle_group = r.muscle_group && r.muscle_group.trim() ? r.muscle_group : getMuscleGroup(primary_muscles, r.name);
      return { ...r, primary_muscles, muscle_group };
    });

    if (boostTargetId && out.length > 0) {
      const blended = blendRankedWithNeverTried(out, (e) => exerciseSearchScore(e.name, q, e.id, statsMap, favoriteIds), {
        maxTotal: 30,
        maxHighSignal: 20,
      });
      return NextResponse.json(blended);
    }

    if (q.length > 0) {
      return NextResponse.json(out.slice(0, 25));
    }
    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to search exercises" }, { status: 500 });
  }
}

/** POST { name, type: 'lift'|'cardio', primary_muscles?, secondary_muscles?, equipment? } — add one exercise (admin/seed). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const type = body.type === "cardio" ? "cardio" : "lift";
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const primary_muscles = body.primary_muscles != null ? String(body.primary_muscles) : "";
    const secondary_muscles = body.secondary_muscles != null ? String(body.secondary_muscles) : "";
    const equipment = body.equipment != null ? String(body.equipment) : "";
    const muscle_group = body.muscle_group && String(body.muscle_group).trim() ? String(body.muscle_group).trim() : getMuscleGroup(primary_muscles);
    const instructionsArr = Array.isArray(body.instructions) ? body.instructions : body.instructions != null ? [String(body.instructions)] : [];
    const instructions = instructionsArr.length > 0 ? JSON.stringify(instructionsArr.map(String)) : "";

    const db = getDb();
    ensureWorkoutTables(db);
    const existing = db.prepare("SELECT id FROM exercises WHERE name = ? AND type = ?").get(name, type);
    if (existing) {
      db.close();
      return NextResponse.json((existing as { id: number }).id);
    }
    const result = db
      .prepare(
        "INSERT INTO exercises (name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions);
    const id = result.lastInsertRowid as number;
    db.close();
    return NextResponse.json({ id, name, type, primary_muscles, secondary_muscles, equipment, muscle_group });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add exercise" }, { status: 500 });
  }
}
