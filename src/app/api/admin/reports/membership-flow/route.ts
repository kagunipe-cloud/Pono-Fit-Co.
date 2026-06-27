import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  buildMembershipFlowReport,
  type MembershipFlowTab,
  MEMBERSHIP_FLOW_TABS,
} from "@/lib/membership-flow";

export const dynamic = "force-dynamic";

export type { MembershipFlowRow } from "@/lib/membership-flow-shared";

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&tab=all|monthly-recurring|... */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();
  const tab = (sp.get("tab") ?? "all").trim() as MembershipFlowTab;

  if (!from || !to || !isYmd(from) || !isYmd(to)) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)." }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "from must be on or before to." }, { status: 400 });
  }
  if (!MEMBERSHIP_FLOW_TABS.some((t) => t.id === tab)) {
    return NextResponse.json({ error: "Invalid tab." }, { status: 400 });
  }

  try {
    const db = getDb();
    const tz = getAppTimezone(db);
    const { events, summary } = buildMembershipFlowReport(db, from, to, tz, tab);
    db.close();

    return NextResponse.json({
      timezone: tz,
      from,
      to,
      tab,
      summary,
      events,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to build report." }, { status: 500 });
  }
}
