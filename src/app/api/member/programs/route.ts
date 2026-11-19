import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const memberId = await getMemberIdFromSession();
  if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const db = getDb();
  ensureWorkoutTables(db);
  const rows = db
    .prepare(
      `SELECT a.id, a.program_id, a.source, a.starts_on, a.status, a.created_at,
              p.title, p.description,
              (SELECT COUNT(*) FROM training_program_workouts w WHERE w.program_id = p.id) AS workout_count
       FROM member_program_assignments a
       JOIN training_programs p ON p.id = a.program_id
       WHERE a.member_id = ? AND a.status = 'active'
       ORDER BY a.created_at DESC`
    )
    .all(memberId);
  db.close();
  return NextResponse.json({ assignments: rows });
}