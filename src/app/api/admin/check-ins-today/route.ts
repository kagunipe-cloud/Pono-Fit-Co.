import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, getOpenHours } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureUsageTables } from "@/lib/usage";
import { todayInAppTz } from "@/lib/app-timezone";
import { OCCUPANCY_DEDUPE_MINUTES } from "@/lib/occupancy";

export const dynamic = "force-dynamic";

type DoorRow = {
  happened_at: string;
  member_id: string | null;
  uuid: string;
};

/** Same identity rule as occupancy +1: linked members dedupe by member_id; unlinked events are one row each (uuid). */
function identityKey(r: DoorRow): string {
  const mid = r.member_id?.trim();
  if (mid) return `m:${mid}`;
  return `u:${r.uuid}`;
}

/** Keep first event per identity, then another only if ≥ OCCUPANCY_DEDUPE_MINUTES after the last kept (chronological). */
function dedupeUniqueCheckIns(rows: DoorRow[]): DoorRow[] {
  const ms = OCCUPANCY_DEDUPE_MINUTES * 60 * 1000;
  const sorted = [...rows].sort((a, b) => Date.parse(a.happened_at) - Date.parse(b.happened_at));
  const lastKeptMs = new Map<string, number>();
  const kept: DoorRow[] = [];
  for (const row of sorted) {
    const t = Date.parse(row.happened_at);
    if (Number.isNaN(t)) continue;
    const key = identityKey(row);
    const prev = lastKeptMs.get(key);
    if (prev !== undefined && t - prev < ms) continue;
    lastKeptMs.set(key, t);
    kept.push(row);
  }
  return kept;
}

/** GET: Unique successful door check-ins today (app timezone), binned by hour, same dedupe window as Coconut Count (+1). Admin only. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    ensureUsageTables(db);
    const tz = getAppTimezone(db, 1);
    const { openHourMin, openHourMax } = getOpenHours(db);
    const todayYmd = todayInAppTz(tz);

    const rows = db.prepare(
      `SELECT happened_at, member_id, uuid FROM door_access_events
       WHERE success = 1 AND happened_at >= datetime('now', '-4 days')
       ORDER BY happened_at ASC`
    ).all() as DoorRow[];

    db.close();

    const todayRows = rows.filter((r) => {
      const parsed = parseHappenedAt(r.happened_at, tz);
      return parsed && parsed.ymd === todayYmd;
    });

    const uniqueToday = dedupeUniqueCheckIns(todayRows);

    const countsByHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    for (const r of uniqueToday) {
      const parsed = parseHappenedAt(r.happened_at, tz);
      if (!parsed) continue;
      const h = clampHour(parsed.hour);
      countsByHour[h].count += 1;
    }

    const hoursInRange = Array.from({ length: openHourMax - openHourMin + 1 }, (_, i) => openHourMin + i);
    const byHour = hoursInRange.map((hour) => ({
      hour,
      count: countsByHour[hour].count,
    }));

    const totalToday = byHour.reduce((sum, { count }) => sum + count, 0);

    return NextResponse.json({
      date: todayYmd,
      timezone: tz,
      totalToday,
      byHour,
      open_hour_min: openHourMin,
      open_hour_max: openHourMax,
    });
  } catch (err) {
    console.error("[check-ins-today]", err);
    return NextResponse.json({ error: "Failed to load check-ins" }, { status: 500 });
  }
}

function clampHour(h: number): number {
  if (h < 0 || h > 23) return Math.min(23, Math.max(0, h));
  return h;
}

function parseHappenedAt(happened_at: string, tz: string): { ymd: string; hour: number } | null {
  const raw = (happened_at ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = parseInt(hourStr, 10);
  if (!y || !m || !day) return null;
  return { ymd: `${y}-${m}-${day}`, hour: Number.isNaN(hour) ? 0 : hour };
}
