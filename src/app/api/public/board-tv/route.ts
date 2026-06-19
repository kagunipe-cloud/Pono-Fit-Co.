import { NextRequest, NextResponse } from "next/server";
import { getAppTimezone, getDb } from "@/lib/db";
import { boardWeekBounds, todayInAppTz } from "@/lib/app-timezone";
import { buildGoalBoard } from "@/lib/goal-board";
import { getGymRecordsGrid, getGymSpecialRecordsGrid } from "@/lib/gym-records";

export const dynamic = "force-dynamic";

/**
 * Public, no-login feed for the always-on gym TV. Gated by a shared secret
 * (`BOARD_TV_TOKEN`) passed as `?token=` so the Fire TV browser never needs a session.
 * Returns gym records + the weekly goal board top 10.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.BOARD_TV_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json({ error: "TV display is not configured." }, { status: 503 });
  }
  const token = (new URL(request.url).searchParams.get("token") ?? "").trim();
  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const tz = getAppTimezone(db);
    const today = todayInAppTz(tz);
    const { weekStart } = boardWeekBounds(tz, today);

    const records = getGymRecordsGrid(db);
    const special = getGymSpecialRecordsGrid(db);
    const board = buildGoalBoard(db, tz, weekStart, today);
    db.close();

    return NextResponse.json({
      timezone: tz,
      records,
      special,
      goalRows: board.rows.slice(0, 10),
    });
  } catch (err) {
    console.error("[public/board-tv]", err);
    return NextResponse.json({ error: "Failed to load The Board." }, { status: 500 });
  }
}
