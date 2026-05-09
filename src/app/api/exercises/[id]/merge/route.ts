import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** POST { target_id } — merge this duplicate exercise into target_id, preserving linked workout history. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const sourceId = parseInt((await params).id, 10);
    const body = await request.json().catch(() => ({}));
    const targetId = parseInt(String(body.target_id ?? ""), 10);

    if (Number.isNaN(sourceId) || sourceId < 1 || Number.isNaN(targetId) || targetId < 1) {
      return NextResponse.json({ error: "Valid source and target exercise IDs are required" }, { status: 400 });
    }
    if (sourceId === targetId) {
      return NextResponse.json({ error: "Choose a different exercise to merge into" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);
    const source = db.prepare("SELECT id, name, type FROM exercises WHERE id = ?").get(sourceId) as
      | { id: number; name: string; type: string }
      | undefined;
    const target = db.prepare("SELECT id, name, type FROM exercises WHERE id = ?").get(targetId) as
      | { id: number; name: string; type: string }
      | undefined;

    if (!source || !target) {
      db.close();
      return NextResponse.json({ error: "Source or target exercise not found" }, { status: 404 });
    }
    if (source.type !== target.type) {
      db.close();
      return NextResponse.json({ error: "Exercises must have the same type to merge" }, { status: 400 });
    }

    const merge = db.transaction(() => {
      const workoutLinks = db
        .prepare("UPDATE workout_exercises SET exercise_id = ?, exercise_name = ? WHERE exercise_id = ?")
        .run(target.id, target.name, source.id).changes;

      db.prepare(
        "INSERT OR IGNORE INTO member_exercise_favorites (member_id, exercise_id, created_at) SELECT member_id, ?, created_at FROM member_exercise_favorites WHERE exercise_id = ?"
      ).run(target.id, source.id);
      db.prepare("DELETE FROM member_exercise_favorites WHERE exercise_id = ?").run(source.id);

      db.prepare(
        "INSERT OR IGNORE INTO member_1rm_settings (member_id, exercise_id) SELECT member_id, ? FROM member_1rm_settings WHERE exercise_id = ?"
      ).run(target.id, source.id);
      db.prepare("DELETE FROM member_1rm_settings WHERE exercise_id = ?").run(source.id);

      const oneRmRecords = db
        .prepare("UPDATE member_1rm_records SET exercise_id = ? WHERE exercise_id = ?")
        .run(target.id, source.id).changes;

      db.prepare("DELETE FROM exercises WHERE id = ?").run(source.id);
      return { workoutLinks, oneRmRecords };
    });

    const result = merge();
    db.close();

    return NextResponse.json({
      ok: true,
      source_id: source.id,
      target_id: target.id,
      target_name: target.name,
      ...result,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to merge exercise" }, { status: 500 });
  }
}
