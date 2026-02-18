import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { hasClassAtSlot } from "../../../../../lib/schedule-conflicts";
import { getUnavailableInRange } from "../../../../../lib/pt-availability";
import { timeToMinutes } from "../../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

const SLOT_MINUTES = 30;

function isSlotFree(
  db: ReturnType<typeof getDb>,
  date: string,
  startMin: number,
  durationMinutes: number
): boolean {
  const endMin = startMin + durationMinutes;
  for (let m = startMin; m < endMin; m += SLOT_MINUTES) {
    if (hasClassAtSlot(db, date, m)) return false;
  }
  const unavail = getUnavailableInRange(date, date);
  for (const u of unavail) {
    if (u.date !== date) continue;
    const uStart = timeToMinutes(u.start_time);
    const uEnd = timeToMinutes(u.end_time);
    if (startMin < uEnd && endMin > uStart) return false;
  }
  const PT_BUFFER_MINUTES = 15;
  const openBookings = db
    .prepare("SELECT occurrence_date, start_time, duration_minutes FROM pt_open_bookings WHERE occurrence_date = ?")
    .all(date) as { occurrence_date: string; start_time: string; duration_minutes: number }[];
  for (const b of openBookings) {
    const bStart = timeToMinutes(b.start_time);
    const bEnd = bStart + b.duration_minutes;
    if (startMin < bEnd && endMin > bStart) return false;
    if (bStart > endMin && bStart <= endMin + PT_BUFFER_MINUTES) return false;
  }
  const blockBookings = db
    .prepare("SELECT start_time, reserved_minutes FROM pt_block_bookings WHERE occurrence_date = ?")
    .all(date) as { start_time: string; reserved_minutes: number }[];
  for (const b of blockBookings) {
    const bStart = timeToMinutes(b.start_time);
    const bEnd = bStart + b.reserved_minutes;
    if (startMin < bEnd && endMin > bStart) return false;
  }
  return true;
}

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
      "SELECT id, duration_minutes, date_time FROM pt_sessions WHERE id = ?"
    ).get(pt_session_id) as { id: number; duration_minutes: number; date_time: string | null } | undefined;
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
      const parts = timePart.split(":").map((x) => parseInt(x, 10));
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

    let inserted = 0;
    const stmt = db.prepare(
      "INSERT INTO pt_open_bookings (member_id, guest_name, occurrence_date, start_time, duration_minutes, pt_session_id, payment_type) VALUES (?, ?, ?, ?, ?, ?, 'paid')"
    );
    for (const date of dates) {
      if (isSlotFree(db, date, startMin, duration_minutes)) {
        stmt.run(effectiveMemberId, isGuest ? guest_name : null, date, start_time, duration_minutes, pt_session_id);
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
