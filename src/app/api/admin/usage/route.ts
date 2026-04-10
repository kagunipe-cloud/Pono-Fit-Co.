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

/** SQLite stores datetimes as "YYYY-MM-DD HH:MM:SS". ISO strings use "T". Lexicographic compare breaks if formats mix. */
function toSqliteDateTimeCompare(s: string): string {
  return s.trim().replace("T", " ").slice(0, 19);
}

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

/** GET: Door and app usage events (admin only). Query: limit (default 20), offset (door rows), app_offset (app rows), mode, tz. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(MAX_LIMIT, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT);
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));
  const appOffset = Math.max(0, parseInt(searchParams.get("app_offset") ?? "0", 10));
  /** both | door | app — use door-only or app-only when loading more of one stream without re-querying the other. */
  const fetchScope = (searchParams.get("fetch") ?? "both").trim().toLowerCase();
  const wantDoor = fetchScope === "both" || fetchScope === "door";
  const wantApp = fetchScope === "both" || fetchScope === "app";
  const mode = searchParams.get("mode") ?? "today";
  const tz = searchParams.get("tz")?.trim() || APP_TIMEZONE;

  const range = getDateRange(mode, tz);

  try {
    const db = getDb();
    ensureUsageTables(db);

    let doorRows: Record<string, unknown>[] = [];
    if (wantDoor) {
    if (range) {
      const sinceCmp = toSqliteDateTimeCompare(range.since);
      const untilCmp = range.until ? toSqliteDateTimeCompare(range.until) : null;
      const happenedNorm = `substr(replace(replace(d.happened_at, 'T', ' '), 'Z', ''), 1, 19)`;
      if (untilCmp) {
        doorRows = db.prepare(
          `SELECT d.id, d.uuid, d.member_id, d.kisi_actor_id, d.kisi_actor_name, d.lock_id, d.lock_name, d.success, d.happened_at, d.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM door_access_events d
           LEFT JOIN members m ON m.member_id = d.member_id
           WHERE ${happenedNorm} >= ? AND ${happenedNorm} <= ?
           ORDER BY d.happened_at DESC LIMIT ? OFFSET ?`
        ).all(sinceCmp, untilCmp, limit, offset) as Record<string, unknown>[];
      } else {
        doorRows = db.prepare(
          `SELECT d.id, d.uuid, d.member_id, d.kisi_actor_id, d.kisi_actor_name, d.lock_id, d.lock_name, d.success, d.happened_at, d.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM door_access_events d
           LEFT JOIN members m ON m.member_id = d.member_id
           WHERE ${happenedNorm} >= ? ORDER BY d.happened_at DESC LIMIT ? OFFSET ?`
        ).all(sinceCmp, limit, offset) as Record<string, unknown>[];
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
    }

    const since = range?.since ?? null;
    const until = range?.until ?? null;
    const sinceCmp = since ? toSqliteDateTimeCompare(since) : null;
    const untilCmp = until ? toSqliteDateTimeCompare(until) : null;

    let appRows: Record<string, unknown>[] = [];
    if (wantApp) {
    if (sinceCmp && untilCmp) {
      appRows = db.prepare(
        `SELECT a.id, a.member_id, a.event_type, a.path, a.created_at,
          TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
         FROM app_usage_events a
         LEFT JOIN members m ON m.member_id = a.member_id
         WHERE a.created_at >= ? AND a.created_at <= ?
         ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
      ).all(sinceCmp, untilCmp, limit, appOffset) as Record<string, unknown>[];
    } else if (sinceCmp) {
      appRows = db.prepare(
        `SELECT a.id, a.member_id, a.event_type, a.path, a.created_at,
          TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
         FROM app_usage_events a
         LEFT JOIN members m ON m.member_id = a.member_id
         WHERE a.created_at >= ?
         ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
      ).all(sinceCmp, limit, appOffset) as Record<string, unknown>[];
    } else {
      appRows = db.prepare(
        `SELECT a.id, a.member_id, a.event_type, a.path, a.created_at,
          TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
         FROM app_usage_events a
         LEFT JOIN members m ON m.member_id = a.member_id
         ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
      ).all(limit, appOffset) as Record<string, unknown>[];
    }
    }

    const hasMore = wantDoor && doorRows.length === limit;
    const hasMoreApp = wantApp && appRows.length === limit;

    db.close();

    return NextResponse.json({
      door: doorRows as Record<string, unknown>[],
      app: appRows as Record<string, unknown>[],
      hasMore,
      hasMoreApp,
    });
  } catch (err) {
    console.error("[admin/usage]", err);
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 });
  }
}
