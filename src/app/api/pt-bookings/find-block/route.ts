import { NextRequest, NextResponse } from "next/server";
import { getBlocksInRange } from "../../../../lib/pt-availability";
import { timeToMinutes } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/**
 * GET ?date=YYYY-MM-DD&time=HH:mm&trainer_member_id=xxx
 * Returns { block_id: number } if a trainer availability block exists for that trainer at that date/time, else { block_id: null }.
 */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date")?.trim();
  const time = request.nextUrl.searchParams.get("time")?.trim();
  const trainer_member_id = request.nextUrl.searchParams.get("trainer_member_id")?.trim();
  if (!date || !time || !trainer_member_id) {
    return NextResponse.json({ error: "date, time, trainer_member_id required" }, { status: 400 });
  }
  const blocks = getBlocksInRange(date, date);
  const startMin = timeToMinutes(time);
  const block = blocks.find((b) => {
    if ((b.trainer_member_id ?? "").trim() !== trainer_member_id.trim()) return false;
    const blockStart = timeToMinutes(b.start_time);
    const blockEnd = timeToMinutes(b.end_time);
    return startMin >= blockStart && startMin < blockEnd;
  });
  return NextResponse.json({ block_id: block?.id ?? null });
}
