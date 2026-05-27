import { NextResponse } from "next/server";
import { getAppTimezone, getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { getMemberGoalBoardPreview } from "@/lib/goal-board";

export const dynamic = "force-dynamic";

/** GET — current member's Goal Board row for home preview. */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    const tz = getAppTimezone(db);
    const preview = getMemberGoalBoardPreview(db, memberId, tz);
    db.close();

    return NextResponse.json(preview);
  } catch (err) {
    console.error("[member/goal-board GET]", err);
    return NextResponse.json({ error: "Failed to load goal board preview" }, { status: 500 });
  }
}
