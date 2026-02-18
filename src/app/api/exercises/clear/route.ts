import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/**
 * POST — delete all rows from the exercises table.
 * Body: { "confirm": true } required.
 * Use this to wipe the exercise DB and re-import from free-exercise-db or wger only.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== true) {
      return NextResponse.json({ error: "Send { \"confirm\": true } in the body to clear all exercises" }, { status: 400 });
    }
    const db = getDb();
    ensureWorkoutTables(db);
    // Unlink workout_exercises so the delete doesn't hit the foreign key
    db.prepare("UPDATE workout_exercises SET exercise_id = NULL WHERE exercise_id IS NOT NULL").run();
    const result = db.prepare("DELETE FROM exercises").run();
    db.close();
    return NextResponse.json({ deleted: result.changes });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to clear exercises" }, { status: 500 });
  }
}
