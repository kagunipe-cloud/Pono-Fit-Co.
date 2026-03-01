import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { hasClassAtSlot } from "../../../../lib/schedule-conflicts";
import { getUnavailableInRange } from "../../../../lib/pt-availability";
import { timeToMinutes } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

const SLOT_MINUTES = 30;
const PT_BUFFER_MINUTES = 15;

function isOpenSlotFree(
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
  const openBookings = db
    .prepare("SELECT occurrence_date, start_time, duration_minutes FROM pt_open_bookings WHERE occurrence_date = ?")
    .all(date) as { occurrence_date: string; start_time: string; duration_minutes: number }[];
  for (const b of openBookings) {
    const bStart = timeToMinutes(b.start_time);
    const bEnd = bStart + (b.duration_minutes ?? 60) + PT_BUFFER_MINUTES;
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

/** GET ?date=YYYY-MM-DD&time=HH:mm&duration_minutes=30|60|90 — Check if an open PT slot has enough contiguous time. */
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get("date")?.trim();
    const time = request.nextUrl.searchParams.get("time")?.trim();
    const duration_minutes = [30, 60, 90].includes(Number(request.nextUrl.searchParams.get("duration_minutes")))
      ? Number(request.nextUrl.searchParams.get("duration_minutes"))
      : 60;
    if (!date || !time) {
      return NextResponse.json({ error: "date and time required" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const startMin = timeToMinutes(time);
    const free = isOpenSlotFree(db, date, startMin, duration_minutes);
    db.close();
    return NextResponse.json({ free });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
