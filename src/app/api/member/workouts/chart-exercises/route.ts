import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** GET — list of official exercises this member has logged (for chart dropdown). */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureWorkoutTables(db);
    const rows = db.prepare(`
      SELECT DISTINCT e.id AS exercise_id, e.name, e.type
      FROM exercises e
      JOIN workout_exercises we ON we.exercise_id = e.id
      JOIN workouts w ON w.id = we.workout_id
      WHERE w.member_id = ? AND w.finished_at IS NOT NULL
      ORDER BY e.type, e.name
    `).all(memberId) as { exercise_id: number; name: string; type: string }[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load exercises" }, { status: 500 });
  }
}
