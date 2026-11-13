import { NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { boardWeekBounds, todayInAppTz } from "@/lib/app-timezone";
import { countMemberUniqueCheckInDays } from "@/lib/check-in-board";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const db = getDb();
    const tz = getAppTimezone(db);
    const today = todayInAppTz(tz);
    const { weekStart, weekEnd } = boardWeekBounds(tz, today);
    const weekEndClamped = today < weekEnd ? today : weekEnd;
    const monthStart = `${today.slice(0, 7)}-01`;

    const week = countMemberUniqueCheckInDays(db, memberId, tz, weekStart, weekEndClamped);
    const month = countMemberUniqueCheckInDays(db, memberId, tz, monthStart, today);

    db.close();

    return NextResponse.json({
      timezone: tz,
      today,
      week: {
        start: weekStart,
        end: weekEndClamped,
        visit_days: week.visit_days,
      },
      month: {
        start: monthStart,
        end: today,
        visit_days: month.visit_days,
      },
    });
  } catch (e) {
    console.error("[member/visit-days]", e);
    return NextResponse.json({ error: "Failed to load visit days" }, { status: 500 });
  }
}
