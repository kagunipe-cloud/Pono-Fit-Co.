import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getAppTimezone, getDb } from "@/lib/db";
import { addDaysToDateStr, todayInAppTz, weekStartInAppTz } from "@/lib/app-timezone";
import { buildGoalBoard } from "@/lib/goal-board";

export const dynamic = "force-dynamic";

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const tz = getAppTimezone(db);
    const url = new URL(request.url);
    const today = todayInAppTz(tz);
    const weekParam = (url.searchParams.get("week") ?? "").trim();
    const weekStart = weekParam && isYmd(weekParam) ? weekStartInAppTz(weekParam) : weekStartInAppTz(today);
    const previousWeekStart = addDaysToDateStr(weekStart, -7);

    const current = buildGoalBoard(db, tz, weekStart, today);
    const previous = buildGoalBoard(db, tz, previousWeekStart, today);
    const previousLeader = previous.rows.find((r) => r.overall_percent != null) ?? null;

    db.close();

    return NextResponse.json({
      timezone: tz,
      today,
      current,
      previous,
      previous_leader: previousLeader,
    });
  } catch (err) {
    console.error("[admin/goal-board]", err);
    return NextResponse.json({ error: "Failed to build goal board." }, { status: 500 });
  }
}
