import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** GET — export all exercises as JSON (for analysis, backup, or sharing). */
export async function GET() {
  try {
    const db = getDb();
    ensureWorkoutTables(db);
    const rows = db.prepare(
      "SELECT id, name, type, primary_muscles, secondary_muscles, equipment, muscle_group, instructions, image_path FROM exercises ORDER BY name"
    ).all() as {
      id: number;
      name: string;
      type: string;
      primary_muscles: string | null;
      secondary_muscles: string | null;
      equipment: string | null;
      muscle_group: string | null;
      instructions: string | null;
      image_path: string | null;
    }[];
    db.close();

    return NextResponse.json(rows, {
      headers: {
        "Content-Disposition": "attachment; filename=exercises-export.json",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
