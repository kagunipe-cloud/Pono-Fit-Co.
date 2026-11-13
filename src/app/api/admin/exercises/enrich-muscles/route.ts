import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { enrichExerciseMusclesFromWeb } from "@/lib/exercise-muscle-enrich";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BATCH = 8;

/**
 * POST { exercise_ids?: number[], force?: boolean, apply_low?: boolean }
 * Web lookup primary/secondary/antagonist (Serper + Gemini). Applies high + medium by default.
 */
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
    const applyLow = body.apply_low === true;

    if (ids.length === 0) {
      return NextResponse.json({ error: "exercise_ids required (max 8)" }, { status: 400 });
    }

    const db = getDb();
    ensureWorkoutTables(db);

    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, name, type FROM exercises WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number; name: string; type: string }[];

    const results: Array<{
      id: number;
      applied: boolean;
      confidence: string | null;
      primary_muscles: string | null;
      error?: string;
    }> = [];

    for (const row of rows) {
      try {
        const result = await enrichExerciseMusclesFromWeb(db, row.id, row.name, row.type, {
          force,
          applyLow,
        });
        if (!result) {
          results.push({ id: row.id, applied: false, confidence: null, primary_muscles: null, error: "lookup failed" });
        } else {
          results.push({
            id: row.id,
            applied: result.applied,
            confidence: result.confidence,
            primary_muscles: result.primary_muscles,
            error: !result.applied && result.confidence === "low" ? "low confidence — not saved" : undefined,
          });
        }
      } catch {
        results.push({ id: row.id, applied: false, confidence: null, primary_muscles: null, error: "lookup failed" });
      }
    }

    db.close();
    return NextResponse.json({ updated: results });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Enrich failed" }, { status: 500 });
  }
}
