import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProgramEditorMemberId } from "@/lib/training-program-access";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const editorId = await getProgramEditorMemberId(request);
  if (!editorId) return NextResponse.json({ error: "Trainer or admin access required" }, { status: 403 });

  const programId = parseInt((await params).id, 10);
  const body = (await request.json().catch(() => ({}))) as { client_member_id?: string; starts_on?: string };
  const clientId = String(body.client_member_id ?? "").trim();
  if (!clientId) return NextResponse.json({ error: "client_member_id is required" }, { status: 400 });

  const db = getDb();
  ensureWorkoutTables(db);
  const program = db
    .prepare("SELECT id FROM training_programs WHERE id = ? AND creator_member_id = ?")
    .get(programId, editorId);
  const client = db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(clientId);
  if (!program || !client) {
    db.close();
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const startsOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.starts_on ?? "").trim())
    ? String(body.starts_on).trim()
    : null;

  const r = db
    .prepare(
      `INSERT INTO member_program_assignments (program_id, member_id, source, assigned_by_member_id, starts_on)
       VALUES (?, ?, 'assigned', ?, ?)`
    )
    .run(programId, clientId, editorId, startsOn);

  const assignment = db.prepare("SELECT * FROM member_program_assignments WHERE id = ?").get(r.lastInsertRowid);
  db.close();
  return NextResponse.json({ assignment });
}