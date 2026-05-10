import { NextRequest, NextResponse } from "next/server";
import { getBlocksInRange } from "../../../../lib/pt-availability";
import { timeToMinutes } from "../../../../lib/pt-slots";
import { getDb } from "../../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * GET ?date=YYYY-MM-DD&time=HH:mm&trainer_member_id=xxx
 * Returns { block_id } for trainer availability containing that instant.
 *
 * When multiple rows cover the same trainer + day + time (e.g. an old narrow block and a newer
 * wide one), we return the **widest** block so booking matches what trainers see on their grid.
 * The old `.find()` first-match behavior picked arbitrary DB order and caused "not enough time"
 * while the schedule looked wide open.
 */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date")?.trim();
  const time = request.nextUrl.searchParams.get("time")?.trim();
  const trainer_member_id = request.nextUrl.searchParams.get("trainer_member_id")?.trim();
  if (!date || !time || !trainer_member_id) {
    return NextResponse.json({ error: "date, time, trainer_member_id required" }, { status: 400 });
  }

  let blocks = getBlocksInRange(date, date);
  let matching = blocks.filter((b) => (b.trainer_member_id ?? "").trim() === trainer_member_id.trim());

  if (matching.length === 0) {
    const db = getDb();
    const member = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(trainer_member_id) as
      | { first_name: string | null; last_name: string | null }
      | undefined;
    db.close();
    const displayName = member ? [member.first_name, member.last_name].filter(Boolean).join(" ").trim() : null;
    if (displayName) {
      matching = blocks.filter(
        (b) =>
          (b.trainer_member_id == null || String(b.trainer_member_id).trim() === "") &&
          b.trainer.trim().toLowerCase() === displayName.toLowerCase()
      );
    }
  }

  const startMin = timeToMinutes(time);
  const candidates = matching.filter((b) => {
    const blockStart = timeToMinutes(b.start_time);
    const blockEnd = timeToMinutes(b.end_time);
    return startMin >= blockStart && startMin < blockEnd;
  });

  if (candidates.length === 0) {
    return NextResponse.json({ block_id: null });
  }

  const best = candidates.reduce((a, b) => {
    const spanA = timeToMinutes(a.end_time) - timeToMinutes(a.start_time);
    const spanB = timeToMinutes(b.end_time) - timeToMinutes(b.start_time);
    return spanB > spanA ? b : a;
  });

  return NextResponse.json({ block_id: best.id });
}
