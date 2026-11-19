import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProgramEditorMemberId } from "@/lib/training-program-access";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const db = getDb();
  ensureWorkoutTables(db);
  const rows = db
    .prepare(
      `SELECT id, title, description, is_for_sale, price_cents, published, created_at, updated_at,
        (SELECT COUNT(*) FROM training_program_workouts w WHERE w.program_id = training_programs.id) AS workout_count
       FROM training_programs WHERE creator_member_id = ? ORDER BY updated_at DESC`
    )
    .all(editorId);
  db.close();
  return NextResponse.json({ programs: rows });
}

export async function POST(request: NextRequest) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    is_for_sale?: boolean;
    price_cents?: number | null;
    published?: boolean;
  };
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const db = getDb();
  ensureWorkoutTables(db);
  const r = db
    .prepare(
      `INSERT INTO training_programs (creator_member_id, title, description, is_for_sale, price_cents, published)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      editorId,
      title,
      String(body.description ?? "").trim() || null,
      body.is_for_sale ? 1 : 0,
      body.is_for_sale && typeof body.price_cents === "number" ? Math.max(0, Math.round(body.price_cents)) : null,
      body.published ? 1 : 0
    );
  const program = db
    .prepare("SELECT * FROM training_programs WHERE id = ?")
    .get(r.lastInsertRowid);
  db.close();
  return NextResponse.json({ program });
}