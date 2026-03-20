import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { isPTBookingSlotFree } from "../../../../../lib/schedule-conflicts";
import { timeToMinutes } from "../../../../../lib/pt-slots";
import { getTrainerMemberIdByDisplayName } from "../../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

/**
 * POST { member_id?, guest_name?, pt_session_id, day_of_week (0-6), time ("09:00"), weeks (default 12) }
 * Creates recurring PT open bookings. Provide either member_id (member in system) or guest_name (walk-in).
 * pt_session_id must be a session type (date_time IS NULL).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const guest_name = (body.guest_name ?? "").trim();
    const pt_session_id = parseInt(String(body.pt_session_id), 10);
    const day_of_week = Math.max(0, Math.min(6, parseInt(String(body.day_of_week ?? 1), 10)));
    const time = (body.time ?? "09:00").toString().trim().replace(/\s/g, "");
    const weeks = Math.min(52, Math.max(1, parseInt(String(body.weeks ?? 12), 10)));

    const isGuest = !!guest_name;
    if ((!member_id && !isGuest) || Number.isNaN(pt_session_id)) {
      return NextResponse.json({ error: "Provide either a member (member_id) or a name (guest_name), and session type." }, { status: 400 });
    }
    const effectiveMemberId = isGuest ? "" : member_id;

    const db = getDb();
    ensurePTSlotTables(db);

    const session = db.prepare(
      "SELECT id, duration_minutes, date_time, trainer FROM pt_sessions WHERE id = ?"
    ).get(pt_session_id) as { id: number; duration_minutes: number; date_time: string | null; trainer: string | null } | undefined;
    if (!session || session.date_time != null) {
      db.close();
      return NextResponse.json(
        { error: "PT session type not found. Choose a session with no date/time from PT Sessions." },
        { status: 404 }
      );
    }

    const duration_minutes = session.duration_minutes ?? 60;
    const timePart = time.includes(":") ? time : `${time}:00`;
    const startMin = (() => {
      const parts = timePart.split(":").map((x: string) => parseInt(x, 10));
      return ((parts[0] ?? 0) % 24) * 60 + (parts[1] ?? 0);
    })();
    const start_time = `${Math.floor(startMin / 60).toString().padStart(2, "0")}:${(startMin % 60).toString().padStart(2, "0")}`;

    const fromDate = new Date();
    fromDate.setHours(0, 0, 0, 0);
    const end = new Date(fromDate);
    end.setDate(end.getDate() + weeks * 7);
    const dates: string[] = [];
    const cur = new Date(fromDate);
    while (cur <= end) {
      if (cur.getDay() === day_of_week) {
        dates.push(cur.toISOString().slice(0, 10));
      }
      cur.setDate(cur.getDate() + 1);
    }

    const trainerMemberId = session.trainer ? getTrainerMemberIdByDisplayName(db, session.trainer) : null;
    const recurringGroupId = crypto.randomUUID();
    let inserted = 0;
    const stmt = db.prepare(
      "INSERT INTO pt_open_bookings (member_id, guest_name, occurrence_date, start_time, duration_minutes, pt_session_id, payment_type, trainer_member_id, recurring_group_id) VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?)"
    );
    for (const date of dates) {
      if (isPTBookingSlotFree(db, date, startMin, duration_minutes, trainerMemberId)) {
        stmt.run(effectiveMemberId, isGuest ? guest_name : null, date, start_time, duration_minutes, pt_session_id, trainerMemberId ?? null, recurringGroupId);
        inserted++;
      }
    }
    db.close();
    return NextResponse.json({ success: true, inserted, total: dates.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to generate recurring PT bookings" }, { status: 500 });
  }
}
