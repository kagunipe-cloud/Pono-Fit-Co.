import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

/** POST body: { exercise_ids: number[] } — full ordered list of workout_exercises.id for this workout. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const workoutId = parseInt((await params).id, 10);
    if (Number.isNaN(workoutId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const rawIds = body.exercise_ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: "exercise_ids must be a non-empty array" }, { status: 400 });
    }
    const ids = rawIds.map((x: unknown) => (typeof x === "number" ? x : parseInt(String(x), 10)));
    if (ids.some((n: number) => Number.isNaN(n))) {
      return NextResponse.json({ error: "Invalid exercise id" }, { status: 400 });
    }
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "Duplicate exercise ids" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);
    const owned = db.prepare("SELECT id FROM workouts WHERE id = ? AND member_id = ?").get(workoutId, memberId);
    if (!owned) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const existing = db
      .prepare("SELECT id FROM workout_exercises WHERE workout_id = ? ORDER BY sort_order, id")
      .all(workoutId) as { id: number }[];
    const existingIds = existing.map((e) => e.id);
    if (existingIds.length !== ids.length) {
      db.close();
      return NextResponse.json({ error: "Exercise list must include all exercises for this workout" }, { status: 400 });
    }
    const allowed = new Set(existingIds);
    for (const id of ids) {
      if (!allowed.has(id)) {
        db.close();
        return NextResponse.json({ error: "Invalid exercise id for this workout" }, { status: 400 });
      }
    }

    const update = db.prepare("UPDATE workout_exercises SET sort_order = ? WHERE id = ? AND workout_id = ?");
    const run = db.transaction(() => {
      ids.forEach((exerciseId, order) => {
        update.run(order, exerciseId, workoutId);
      });
    });
    run();
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to reorder exercises" }, { status: 500 });
  }
}
