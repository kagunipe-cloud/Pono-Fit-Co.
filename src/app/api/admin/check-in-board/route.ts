import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { boardWeekBounds, todayInAppTz } from "@/lib/app-timezone";
import { buildCheckInBoard } from "@/lib/check-in-board";
import { getAppTimezone, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET: Current-week check-in days leaderboard for The Board TV preview. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const tz = getAppTimezone(db);
    const today = todayInAppTz(tz);
    const { weekStart } = boardWeekBounds(tz, today);
    const board = buildCheckInBoard(db, tz, weekStart, today);
    db.close();

    return NextResponse.json(board);
  } catch (err) {
    console.error("[admin/check-in-board]", err);
    return NextResponse.json({ error: "Failed to build check-in board." }, { status: 500 });
  }
}
