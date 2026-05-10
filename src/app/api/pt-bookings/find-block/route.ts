import { NextRequest, NextResponse } from "next/server";
import { getBlocksInRange, filterBlocksForTrainerMember, selectWidestBlockContaining } from "../../../../lib/pt-availability";
import { timeToMinutes } from "../../../../lib/pt-slots";

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

  const blocks = getBlocksInRange(date, date);
  const matching = filterBlocksForTrainerMember(blocks, trainer_member_id);
  const startMin = timeToMinutes(time);
  const best = selectWidestBlockContaining(matching, startMin);

  if (!best) {
    return NextResponse.json({ block_id: null });
  }

  return NextResponse.json({ block_id: best.id });
}
