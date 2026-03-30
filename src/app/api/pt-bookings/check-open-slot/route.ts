import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables, normalizePtDurationMinutes, timeToMinutes } from "../../../../lib/pt-slots";
import { isPTBookingSlotFree } from "../../../../lib/schedule-conflicts";
import { getTrainerMemberIdByDisplayName } from "../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

/** GET ?date=YYYY-MM-DD&time=HH:mm&duration_minutes=&pt_session_id= — Check if an open PT slot has enough contiguous time. pt_session_id optional; when provided, buffer only applies to same trainer. */
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get("date")?.trim();
    const time = request.nextUrl.searchParams.get("time")?.trim();
    const duration_minutes = normalizePtDurationMinutes(request.nextUrl.searchParams.get("duration_minutes"), 60);
    const pt_session_id = parseInt(String(request.nextUrl.searchParams.get("pt_session_id")), 10);
    if (!date || !time) {
      return NextResponse.json({ error: "date and time required" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    let trainerMemberId: string | null = null;
    if (!Number.isNaN(pt_session_id)) {
      const session = db.prepare("SELECT trainer FROM pt_sessions WHERE id = ?").get(pt_session_id) as { trainer: string | null } | undefined;
      if (session?.trainer) trainerMemberId = getTrainerMemberIdByDisplayName(db, session.trainer);
    }
    const startMin = timeToMinutes(time);
    const free = isPTBookingSlotFree(db, date, startMin, duration_minutes, trainerMemberId);
    db.close();
    return NextResponse.json({ free });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
