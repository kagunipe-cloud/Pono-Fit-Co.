import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";
import { ensureUsageTables } from "../../../../../lib/usage";
import { endOfDayInTz, startOfDayInTz } from "../../../../../lib/app-timezone";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT_NO_RANGE = 50;
const MAX_LIMIT_RANGE = 8000;

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** GET: Door unlocks for a member. Admin only.
 * Query: `limit` (default 10, max 50) when `from`/`to` omitted.
 * With `from` and `to` (YYYY-MM-DD, app timezone): all unlocks in range, max 8000 rows. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = (await params).id;
  if (!id || id.length < 2) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const from = (searchParams.get("from") ?? "").trim();
  const to = (searchParams.get("to") ?? "").trim();
  const hasRange = from.length > 0 && to.length > 0;

  if ((from && !to) || (!from && to)) {
    return NextResponse.json({ error: "Provide both from and to (YYYY-MM-DD), or neither." }, { status: 400 });
  }
  if (hasRange && (!isYmd(from) || !isYmd(to))) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD." }, { status: 400 });
  }

  const limit = Math.min(
    hasRange ? MAX_LIMIT_RANGE : MAX_LIMIT_NO_RANGE,
    parseInt(searchParams.get("limit") ?? String(hasRange ? MAX_LIMIT_RANGE : DEFAULT_LIMIT), 10) ||
      (hasRange ? MAX_LIMIT_RANGE : DEFAULT_LIMIT)
  );

  try {
    const db = getDb();
    ensureUsageTables(db);
    const tz = getAppTimezone(db);

    const isPurelyNumeric = /^\d+$/.test(id);
    const member = (isPurelyNumeric
      ? db.prepare("SELECT member_id FROM members WHERE id = ? OR member_id = ?").get(parseInt(id, 10), id)
      : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(id)) as { member_id: string } | undefined;

    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const mid = member.member_id;

    let rows: Record<string, unknown>[];
    if (hasRange) {
      const fromIso = startOfDayInTz(from, tz) + "Z";
      const toIso = endOfDayInTz(to, tz) + "Z";
      rows = db
        .prepare(
          `SELECT d.id, d.uuid, d.lock_id, d.lock_name, d.success, d.happened_at
           FROM door_access_events d
           WHERE d.member_id = ?
             AND d.happened_at >= ?
             AND d.happened_at <= ?
           ORDER BY d.happened_at DESC
           LIMIT ?`
        )
        .all(mid, fromIso, toIso, limit) as Record<string, unknown>[];
    } else {
      rows = db
        .prepare(
          `SELECT d.id, d.uuid, d.lock_id, d.lock_name, d.success, d.happened_at
           FROM door_access_events d
           WHERE d.member_id = ?
           ORDER BY d.happened_at DESC
           LIMIT ?`
        )
        .all(mid, limit) as Record<string, unknown>[];
    }

    db.close();

    return NextResponse.json({ unlocks: rows, from: hasRange ? from : null, to: hasRange ? to : null });
  } catch (err) {
    console.error("[members unlocks]", err);
    return NextResponse.json({ error: "Failed to load unlocks" }, { status: 500 });
  }
}
