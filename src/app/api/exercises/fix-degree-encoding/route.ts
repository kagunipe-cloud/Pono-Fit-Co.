import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** POST — replace all Â° (mojibake degree) with ° in the exercises table. */
export async function POST() {
  try {
    const db = getDb();
    ensureWorkoutTables(db);

    const textColumns = ["name", "primary_muscles", "secondary_muscles", "equipment", "muscle_group", "instructions"] as const;
    let totalChanges = 0;

    for (const col of textColumns) {
      // REPLACE(column, 'Â°', '°') — fix UTF-8-mojibake degree symbol
      const result = db.prepare(`UPDATE exercises SET ${col} = REPLACE(CAST(${col} AS TEXT), 'Â°', '°') WHERE ${col} LIKE '%Â°%'`).run();
      totalChanges += result.changes;
    }

    db.close();
    return NextResponse.json({ updated: totalChanges });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fix degree encoding" }, { status: 500 });
  }
}
