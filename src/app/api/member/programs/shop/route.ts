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
      `SELECT p.id, p.title, p.description, p.price_cents,
              m.first_name AS creator_first, m.last_name AS creator_last,
              (SELECT COUNT(*) FROM training_program_workouts w WHERE w.program_id = p.id) AS workout_count
       FROM training_programs p
       LEFT JOIN members m ON m.member_id = p.creator_member_id
       WHERE p.is_for_sale = 1 AND p.published = 1
       ORDER BY p.title COLLATE NOCASE`
    )
    .all();
  db.close();
  return NextResponse.json({ programs: rows });
}