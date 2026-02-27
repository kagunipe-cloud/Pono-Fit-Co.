import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { getTrainerMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

/** GET — list availability blocks for the current trainer (trainer_member_id = me). */
export async function GET() {
  try {
    const memberId = await getTrainerMemberId();
    if (!memberId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db.prepare(
      "SELECT id, trainer, trainer_member_id, day_of_week, days_of_week, start_time, end_time, description, created_at FROM trainer_availability WHERE trainer_member_id = ? ORDER BY day_of_week, start_time"
    ).all(memberId) as { id: number; trainer: string; trainer_member_id: string | null; day_of_week: number; days_of_week: string | null; start_time: string; end_time: string; description: string | null; created_at: string | null }[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch availability" }, { status: 500 });
  }
}

/** POST — create an availability block for the current trainer. */
export async function POST(request: NextRequest) {
  try {
    const memberId = await getTrainerMemberId();
    if (!memberId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const day_of_week = Math.max(0, Math.min(6, parseInt(String(body.day_of_week ?? 0), 10)));
    const days_of_week_str = (body.days_of_week ?? "").trim() || null;
    const start_time = (body.start_time ?? "09:00").toString().trim();
    const end_time = (body.end_time ?? "17:00").toString().trim();
    const description = (body.description ?? "").trim() || null;

    const db = getDb();
    ensurePTSlotTables(db);
    const member = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(memberId) as { first_name: string | null; last_name: string | null } | undefined;
    const trainerName = member ? [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || "Trainer" : "Trainer";

    const result = db.prepare(
      "INSERT INTO trainer_availability (trainer, trainer_member_id, day_of_week, start_time, end_time, description, days_of_week) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(trainerName, memberId, day_of_week, start_time, end_time, description, days_of_week_str);
    const row = db.prepare("SELECT * FROM trainer_availability WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create availability" }, { status: 500 });
  }
}
