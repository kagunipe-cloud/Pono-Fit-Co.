import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { BULGARIAN_SPLIT_SQUAT_MUSCLES, getCanonicalPrimaryMuscles, getMuscleGroup } from "@/lib/muscle-groups";
import { ensureWorkoutTables } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/**
 * POST — one-time backfill: set muscle_group (and canonical primary_muscles where applicable) for rows where muscle_group is null/empty.
 * E.g. all Bulgarian split squats get legs + quadriceps, hamstrings, glutes, hip flexors.
 */
export async function POST() {
  try {
    const db = getDb();
    ensureWorkoutTables(db);

    const rows = db
      .prepare(
        "SELECT id, name, primary_muscles FROM exercises WHERE muscle_group IS NULL OR trim(coalesce(muscle_group, '')) = ''"
      )
      .all() as { id: number; name: string; primary_muscles: string | null }[];

    const updateGroup = db.prepare("UPDATE exercises SET muscle_group = ? WHERE id = ?");
    const updateGroupAndMuscles = db.prepare("UPDATE exercises SET muscle_group = ?, primary_muscles = ? WHERE id = ?");
    let updated = 0;
    for (const row of rows) {
      const canonical = getCanonicalPrimaryMuscles(row.name);
      const group = getMuscleGroup(row.primary_muscles ?? "", row.name);
      if (canonical) {
        updateGroupAndMuscles.run(group, canonical, row.id);
      } else {
        updateGroup.run(group, row.id);
      }
      updated++;
    }
    // Also fix all Bulgarian split squats in DB (even if they already had a muscle_group)
    const fixBss = db.prepare("UPDATE exercises SET muscle_group = 'legs', primary_muscles = ? WHERE lower(trim(name)) LIKE '%bulgarian%split%squat%'");
    const bssResult = fixBss.run(BULGARIAN_SPLIT_SQUAT_MUSCLES);
    updated += bssResult.changes;

    // Fix rows that have muscle_group = 'core': re-derive from primary_muscles + name (e.g. "assisted chin up" -> back)
    const coreRows = db.prepare(
      "SELECT id, name, primary_muscles FROM exercises WHERE trim(coalesce(muscle_group, '')) = 'core'"
    ).all() as { id: number; name: string; primary_muscles: string | null }[];
    for (const row of coreRows) {
      const group = getMuscleGroup(row.primary_muscles ?? "", row.name);
      if (group !== "core") {
        updateGroup.run(group, row.id);
        updated++;
      }
    }

    db.close();
    return NextResponse.json({ updated, total: rows.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
