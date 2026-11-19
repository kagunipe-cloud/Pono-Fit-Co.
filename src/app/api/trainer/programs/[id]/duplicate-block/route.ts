import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProgramEditorMemberId } from "@/lib/training-program-access";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

/**
 * Duplicate workouts from a day range onto later days (for week/month/block copy).
 * Body: { from_day_start, from_day_end, to_day_start, copies?: 1 }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const programId = parseInt((await params).id, 10);
  const body = (await request.json().catch(() => ({}))) as {
    from_day_start?: number;
    from_day_end?: number;
    to_day_start?: number;
    copies?: number;
  };

  const fromStart = Math.max(1, body.from_day_start ?? 1);
  const fromEnd = Math.max(fromStart, body.from_day_end ?? fromStart);
  const toStart = Math.max(1, body.to_day_start ?? fromEnd + 1);
  const copies = Math.min(12, Math.max(1, body.copies ?? 1));
  const span = fromEnd - fromStart + 1;

  const db = getDb();
  ensureWorkoutTables(db);
  const program = db
    .prepare("SELECT id FROM training_programs WHERE id = ? AND creator_member_id = ?")
    .get(programId, editorId);
  if (!program) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const src = db
    .prepare(
      `SELECT day_index, sort_order, name, training_phase, template_json
       FROM training_program_workouts WHERE program_id = ? AND day_index >= ? AND day_index <= ?
       ORDER BY day_index, sort_order`
    )
    .all(programId, fromStart, fromEnd) as {
    day_index: number;
    sort_order: number;
    name: string;
    training_phase: string;
    template_json: string;
  }[];

  let inserted = 0;
  const ins = db.prepare(
    `INSERT INTO training_program_workouts (program_id, day_index, sort_order, name, training_phase, template_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (let c = 0; c < copies; c++) {
    const dayOffset = toStart - fromStart + c * span;
    for (const row of src) {
      const newDay = row.day_index + dayOffset;
      ins.run(programId, newDay, row.sort_order, row.name, row.training_phase, row.template_json);
      inserted++;
    }
  }

  db.prepare("UPDATE training_programs SET updated_at = datetime('now') WHERE id = ?").run(programId);
  db.close();
  return NextResponse.json({ inserted, from_day_start: fromStart, from_day_end: fromEnd, to_day_start: toStart, copies });
}