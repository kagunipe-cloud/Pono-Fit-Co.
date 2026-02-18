import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getBlocksInRange, getUnavailableInRange, getUnavailableRangesForBlock, getBookableStartTimes, getBlockSegments } from "../../../../lib/pt-availability";

export const dynamic = "force-dynamic";

/**
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&member_id= (optional)&segments=1 (optional)
 * Returns trainer availability blocks in range. Each block has date, trainer, start/end,
 * bookable_start_times: { 30: [...], 60: [...], 90: [...] },
 * and if member_id given: my_booking. If segments=1, each block includes segments: [{ start_time, end_time, booked, member_name?, trainer }].
 */
export async function GET(request: NextRequest) {
  try {
    const from = request.nextUrl.searchParams.get("from")?.trim();
    const to = request.nextUrl.searchParams.get("to")?.trim();
    const member_id = request.nextUrl.searchParams.get("member_id")?.trim() || null;
    const segments = request.nextUrl.searchParams.get("segments") === "1";
    if (!from || !to) {
      return NextResponse.json({ error: "from and to (YYYY-MM-DD) required" }, { status: 400 });
    }

    const blocks = getBlocksInRange(from, to);
    const unavailableOccurrences = getUnavailableInRange(from, to);
    const db = getDb();

    const result = blocks.map((block) => {
      const unavailRanges = getUnavailableRangesForBlock(block, block.date, unavailableOccurrences);
      const bookable30 = getBookableStartTimes(db, block.id, block.date, block.start_time, block.end_time, 30, unavailRanges);
      const bookable60 = getBookableStartTimes(db, block.id, block.date, block.start_time, block.end_time, 60, unavailRanges);
      const bookable90 = getBookableStartTimes(db, block.id, block.date, block.start_time, block.end_time, 90, unavailRanges);
      let my_booking: { start_time: string; session_duration_minutes: number; reserved_minutes: number } | null = null;
      if (member_id) {
        const rows = db.prepare(
          "SELECT start_time, session_duration_minutes, reserved_minutes FROM pt_block_bookings WHERE trainer_availability_id = ? AND occurrence_date = ? AND member_id = ?"
        ).all(block.id, block.date, member_id) as { start_time: string; session_duration_minutes: number; reserved_minutes: number }[];
        if (rows.length > 0) my_booking = rows[0];
      }
      const out: Record<string, unknown> = {
        ...block,
        bookable_start_times: { 30: bookable30, 60: bookable60, 90: bookable90 },
        my_booking,
      };
      if (segments) {
        out.segments = getBlockSegments(db, block, block.date, unavailableOccurrences);
      }
      return out;
    });

    db.close();
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT availability" }, { status: 500 });
  }
}
