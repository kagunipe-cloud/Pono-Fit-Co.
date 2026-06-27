import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { startOfDayInTz, endOfDayInTz } from "@/lib/app-timezone";
import { ensureAutoRenewEventsTable, type AutoRenewChangeSource } from "@/lib/auto-renew-events";

export const dynamic = "force-dynamic";

export type AutoRenewChangeRow = {
  id: number;
  member_id: string;
  member_name: string;
  email: string | null;
  enabled: number;
  previous_enabled: number | null;
  changed_at: string;
  changed_by_member_id: string | null;
  changed_by_name: string | null;
  source: AutoRenewChangeSource;
};

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&direction=all|on|off */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();
  const direction = (sp.get("direction") ?? "all").trim();

  if (!from || !to || !isYmd(from) || !isYmd(to)) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)." }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "from must be on or before to." }, { status: 400 });
  }
  if (!["all", "on", "off"].includes(direction)) {
    return NextResponse.json({ error: "direction must be all, on, or off." }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureAutoRenewEventsTable(db);
    const tz = getAppTimezone(db);
    const fromSql = startOfDayInTz(from, tz).replace("T", " ").slice(0, 19);
    const toSql = endOfDayInTz(to, tz).replace("T", " ").slice(0, 19);

    let directionSql = "";
    if (direction === "on") directionSql = " AND e.enabled = 1";
    else if (direction === "off") directionSql = " AND e.enabled = 0";

    const rows = db
      .prepare(
        `SELECT e.id, e.member_id, e.enabled, e.previous_enabled, e.changed_at,
                e.changed_by_member_id, e.source,
                m.first_name, m.last_name, m.email,
                cb.first_name AS changed_by_first, cb.last_name AS changed_by_last
         FROM auto_renew_events e
         INNER JOIN members m ON m.member_id = e.member_id
         LEFT JOIN members cb ON cb.member_id = e.changed_by_member_id
         WHERE e.changed_at >= ? AND e.changed_at <= ?
         ${directionSql}
         ORDER BY e.changed_at DESC, e.id DESC`
      )
      .all(fromSql, toSql) as {
      id: number;
      member_id: string;
      enabled: number;
      previous_enabled: number | null;
      changed_at: string;
      changed_by_member_id: string | null;
      source: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      changed_by_first: string | null;
      changed_by_last: string | null;
    }[];

    db.close();

    const events: AutoRenewChangeRow[] = rows.map((r) => ({
      id: r.id,
      member_id: r.member_id,
      member_name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id,
      email: r.email,
      enabled: r.enabled,
      previous_enabled: r.previous_enabled,
      changed_at: r.changed_at,
      changed_by_member_id: r.changed_by_member_id,
      changed_by_name: r.changed_by_member_id
        ? [r.changed_by_first, r.changed_by_last].filter(Boolean).join(" ").trim() || r.changed_by_member_id
        : null,
      source: r.source as AutoRenewChangeSource,
    }));

    const turnedOn = events.filter((e) => e.enabled === 1).length;
    const turnedOff = events.filter((e) => e.enabled === 0).length;

    return NextResponse.json({
      timezone: tz,
      from,
      to,
      direction,
      turned_on: turnedOn,
      turned_off: turnedOff,
      events,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to build report." }, { status: 500 });
  }
}
