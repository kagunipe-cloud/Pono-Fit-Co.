import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";
import { ensureUsageTables } from "../../../../lib/usage";
import {
  todayInAppTz,
  addDaysToDateStr,
  startOfDayInTz,
  endOfDayInTz,
  APP_TIMEZONE,
} from "../../../../lib/app-timezone";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;

type DateRange = { since: string; until: string | null };

function getDateRange(mode: string, tz: string): DateRange | null {
  const today = todayInAppTz(tz);
  if (mode === "today") {
    return { since: startOfDayInTz(today, tz), until: endOfDayInTz(today, tz) };
  }
  if (mode === "yesterday") {
    const yesterday = addDaysToDateStr(today, -1);
    return { since: startOfDayInTz(yesterday, tz), until: endOfDayInTz(yesterday, tz) };
  }
  const days = parseInt(mode, 10);
  if (days > 0) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    return { since, until: null };
  }
  return null;
}

/** GET: Door and app usage events (admin only). Query: limit (default 20), offset (0), mode (today|yesterday|7|30|90|all), tz (for today/yesterday). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(MAX_LIMIT, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT);
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));
  const mode = searchParams.get("mode") ?? "today";
  const tz = searchParams.get("tz")?.trim() || APP_TIMEZONE;

  const range = getDateRange(mode, tz);

  try {
    const db = getDb();
    ensureUsageTables(db);

    let doorRows: Record<string, unknown>[];
    if (range) {
      if (range.until) {
        doorRows = db.prepare(
          `SELECT d.id, d.uuid, d.member_id, d.kisi_actor_id, d.kisi_actor_name, d.lock_id, d.lock_name, d.success, d.happened_at, d.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM door_access_events d
           LEFT JOIN members m ON m.member_id = d.member_id
           WHERE d.happened_at >= ? AND d.happened_at <= ?
           ORDER BY d.happened_at DESC LIMIT ? OFFSET ?`
        ).all(range.since, range.until, limit, offset) as Record<string, unknown>[];
      } else {
        doorRows = db.prepare(
          `SELECT d.id, d.uuid, d.member_id, d.kisi_actor_id, d.kisi_actor_name, d.lock_id, d.lock_name, d.success, d.happened_at, d.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM door_access_events d
           LEFT JOIN members m ON m.member_id = d.member_id
           WHERE d.happened_at >= ? ORDER BY d.happened_at DESC LIMIT ? OFFSET ?`
        ).all(range.since, limit, offset) as Record<string, unknown>[];
      }
    } else {
      doorRows = db.prepare(
        `SELECT d.id, d.uuid, d.member_id, d.kisi_actor_id, d.kisi_actor_name, d.lock_id, d.lock_name, d.success, d.happened_at, d.created_at,
          TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
         FROM door_access_events d
         LEFT JOIN members m ON m.member_id = d.member_id
         ORDER BY d.happened_at DESC LIMIT ? OFFSET ?`
      ).all(limit, offset) as Record<string, unknown>[];
    }

    const since = range?.since ?? null;
    const appRows = since
      ? db.prepare(
          `SELECT a.id, a.member_id, a.event_type, a.path, a.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM app_usage_events a
           LEFT JOIN members m ON m.member_id = a.member_id
           WHERE a.created_at >= ? ORDER BY a.created_at DESC LIMIT ?`
        ).all(since, limit)
      : db.prepare(
          `SELECT a.id, a.member_id, a.event_type, a.path, a.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM app_usage_events a
           LEFT JOIN members m ON m.member_id = a.member_id
           ORDER BY a.created_at DESC LIMIT ?`
        ).all(limit);

    const hasMore = doorRows.length === limit;

    db.close();

    return NextResponse.json({
      door: doorRows as Record<string, unknown>[],
      app: appRows as Record<string, unknown>[],
      hasMore,
    });
  } catch (err) {
    console.error("[admin/usage]", err);
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 });
  }
}
