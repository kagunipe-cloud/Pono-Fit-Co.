import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/**
 * GET — Returns all designated "My 1RM" exercises and their current best.
 * { exercises: [{ exercise_id, exercise_name, current_1rm_lbs, records: [{ date, estimated_1rm_lbs }] }] }
 */
export async function GET(_request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureWorkoutTables(db);

    const settings = db.prepare("SELECT exercise_id FROM member_1rm_settings WHERE member_id = ?").all(memberId) as { exercise_id: number }[];
    if (settings.length === 0) {
      db.close();
      return NextResponse.json({ exercises: [] });
    }

    const exercises: { exercise_id: number; exercise_name: string; current_1rm_lbs: number | null; records: { date: string; estimated_1rm_lbs: number }[] }[] = [];

    for (const { exercise_id } of settings) {
      const ex = db.prepare("SELECT id, name FROM exercises WHERE id = ?").get(exercise_id) as { id: number; name: string } | undefined;
      if (!ex) continue;

      const records = db.prepare(
        "SELECT recorded_at, estimated_1rm_lbs FROM member_1rm_records WHERE member_id = ? AND exercise_id = ? ORDER BY recorded_at DESC LIMIT 50"
      ).all(memberId, exercise_id) as { recorded_at: string; estimated_1rm_lbs: number }[];

      const current_1rm_lbs = records.length > 0 ? Math.max(...records.map((r) => r.estimated_1rm_lbs)) : null;

      exercises.push({
        exercise_id: ex.id,
        exercise_name: ex.name,
        current_1rm_lbs: current_1rm_lbs != null ? Math.round(current_1rm_lbs * 10) / 10 : null,
        records: records.map((r) => ({ date: r.recorded_at.slice(0, 10), estimated_1rm_lbs: Math.round(r.estimated_1rm_lbs * 10) / 10 })),
      });
    }

    db.close();

    return NextResponse.json({ exercises });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load My 1RM" }, { status: 500 });
  }
}
