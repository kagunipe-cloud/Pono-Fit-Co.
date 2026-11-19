import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProgramEditorMemberId } from "@/lib/training-program-access";
import {
  parseProgramTemplateJson,
  parseTrainingPhase,
  TRAINING_PHASES,
} from "@/lib/training-programs";
import type { TrainerAssignedExercisePayload } from "@/lib/trainer-assigned-workout-content";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

function loadProgram(db: ReturnType<typeof getDb>, id: number, editorId: string) {
  return db
    .prepare("SELECT * FROM training_programs WHERE id = ? AND creator_member_id = ?")
    .get(id, editorId) as Record<string, unknown> | undefined;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const id = parseInt((await params).id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getDb();
  ensureWorkoutTables(db);
  const program = loadProgram(db, id, editorId);
  if (!program) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const workouts = db
    .prepare(
      `SELECT id, day_index, sort_order, name, training_phase, template_json
       FROM training_program_workouts WHERE program_id = ? ORDER BY day_index, sort_order, id`
    )
    .all(id) as {
    id: number;
    day_index: number;
    sort_order: number;
    name: string;
    training_phase: string;
    template_json: string;
  }[];
  const rules = db
    .prepare(
      `SELECT r.* FROM training_program_progression_rules r
       JOIN training_program_workouts w ON w.id = r.program_workout_id
       WHERE w.program_id = ?`
    )
    .all(id);
  db.close();

  return NextResponse.json({
    program,
    workouts: workouts.map((w) => ({
      ...w,
      exercises: parseProgramTemplateJson(w.template_json),
      training_phase: parseTrainingPhase(w.training_phase),
    })),
    progression_rules: rules,
    training_phases: TRAINING_PHASES,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const id = parseInt((await params).id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const db = getDb();
  ensureWorkoutTables(db);
  if (!loadProgram(db, id, editorId)) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (typeof body.title === "string" && body.title.trim()) {
    db.prepare("UPDATE training_programs SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
      body.title.trim(),
      id
    );
  }
  if (typeof body.description === "string") {
    db.prepare("UPDATE training_programs SET description = ?, updated_at = datetime('now') WHERE id = ?").run(
      body.description.trim() || null,
      id
    );
  }
  if (typeof body.is_for_sale === "boolean") {
    db.prepare("UPDATE training_programs SET is_for_sale = ?, updated_at = datetime('now') WHERE id = ?").run(
      body.is_for_sale ? 1 : 0,
      id
    );
  }
  if (body.price_cents === null || typeof body.price_cents === "number") {
    const cents = body.price_cents == null ? null : Math.max(0, Math.round(body.price_cents));
    db.prepare("UPDATE training_programs SET price_cents = ?, updated_at = datetime('now') WHERE id = ?").run(cents, id);
  }
  if (typeof body.published === "boolean") {
    db.prepare("UPDATE training_programs SET published = ?, updated_at = datetime('now') WHERE id = ?").run(
      body.published ? 1 : 0,
      id
    );
  }

  if (Array.isArray(body.workouts)) {
    for (const row of body.workouts as Record<string, unknown>[]) {
      const wid = typeof row.id === "number" ? row.id : parseInt(String(row.id ?? ""), 10);
      if (!Number.isFinite(wid)) continue;
      const owned = db
        .prepare("SELECT id FROM training_program_workouts WHERE id = ? AND program_id = ?")
        .get(wid, id);
      if (!owned) continue;
      if (typeof row.day_index === "number") {
        db.prepare("UPDATE training_program_workouts SET day_index = ? WHERE id = ?").run(Math.max(1, row.day_index), wid);
      }
      if (typeof row.sort_order === "number") {
        db.prepare("UPDATE training_program_workouts SET sort_order = ? WHERE id = ?").run(row.sort_order, wid);
      }
      if (typeof row.name === "string" && row.name.trim()) {
        db.prepare("UPDATE training_program_workouts SET name = ? WHERE id = ?").run(row.name.trim(), wid);
      }
      if (row.training_phase != null) {
        db.prepare("UPDATE training_program_workouts SET training_phase = ? WHERE id = ?").run(
          parseTrainingPhase(row.training_phase),
          wid
        );
      }
      if (Array.isArray(row.exercises)) {
        db.prepare("UPDATE training_program_workouts SET template_json = ? WHERE id = ?").run(
          JSON.stringify(row.exercises as TrainerAssignedExercisePayload[]),
          wid
        );
      }
    }
    db.prepare("UPDATE training_programs SET updated_at = datetime('now') WHERE id = ?").run(id);
  }

  db.close();
  return NextResponse.json({ ok: true });
}