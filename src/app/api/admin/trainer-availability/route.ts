import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

/** POST { trainer_member_id, day_of_week, start_time, end_time, description?, days_of_week? } — Admin only. Add recurring availability for a trainer. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const trainer_member_id = (body.trainer_member_id ?? "").trim() || null;
    const description = (body.description ?? "").trim() || null;
    const days_of_week_str = (body.days_of_week ?? "").trim() || null;
    const day_of_week = Math.max(0, Math.min(6, parseInt(String(body.day_of_week ?? 0), 10)));
    const start_time = (body.start_time ?? "09:00").toString().trim();
    const end_time = (body.end_time ?? "17:00").toString().trim();

    if (!trainer_member_id) {
      return NextResponse.json({ error: "trainer_member_id required" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);
    const member = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(trainer_member_id) as
      | { first_name: string | null; last_name: string | null }
      | undefined;
    const trainerName = member ? [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || "Trainer" : "Trainer";

    const result = db.prepare(
      "INSERT INTO trainer_availability (trainer, trainer_member_id, day_of_week, start_time, end_time, description, days_of_week) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(trainerName, trainer_member_id, day_of_week, start_time, end_time, description, days_of_week_str);
    const row = db.prepare("SELECT * FROM trainer_availability WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create trainer availability" }, { status: 500 });
  }
}
