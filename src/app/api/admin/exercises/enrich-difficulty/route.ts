import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { lookupExerciseDifficultyFromWeb } from "@/lib/exercise-difficulty";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BATCH = 12;

/** POST { exercise_ids?: number[] } — web lookup difficulty for up to 12 exercises (Serper + Gemini). */
export async function POST(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const rawIds = Array.isArray(body.exercise_ids) ? body.exercise_ids : [];
    const ids = [...new Set(rawIds.map((id: unknown) => parseInt(String(id), 10)).filter((n: number) => n > 0))].slice(
      0,
      MAX_BATCH
    );
    const force = body.force === true;

    if (ids.length === 0) {
      return NextResponse.json({ error: "exercise_ids required (max 12)" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, name, type FROM exercises WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number; name: string; type: string }[];

    const results: { id: number; difficulty: string | null; error?: string }[] = [];

    for (const row of rows) {
      try {
        const level = await lookupExerciseDifficultyFromWeb(db, row.id, row.name, row.type, { force });
        results.push({ id: row.id, difficulty: level });
      } catch {
        results.push({ id: row.id, difficulty: null, error: "lookup failed" });
      }
    }

    db.close();
    return NextResponse.json({ updated: results });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Enrich failed" }, { status: 500 });
  }
}
