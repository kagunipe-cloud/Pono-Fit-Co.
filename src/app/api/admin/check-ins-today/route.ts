import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, getOpenHours } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureUsageTables } from "@/lib/usage";
import { todayInAppTz } from "@/lib/app-timezone";

export const dynamic = "force-dynamic";

/** GET: Count of successful door unlocks today (app timezone), binned by hour. Resets every calendar day. Admin only. */
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
      `SELECT happened_at FROM door_access_events
       WHERE success = 1 AND happened_at >= datetime('now', '-4 days')
       ORDER BY happened_at ASC`
    ).all() as { happened_at: string }[];

    db.close();

    const countsByHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    let totalToday = 0;

    for (const { happened_at } of rows) {
      const parsed = parseHappenedAt(happened_at, tz);
      if (!parsed || parsed.ymd !== todayYmd) continue;
      const h = clampHour(parsed.hour);
      countsByHour[h].count += 1;
      totalToday += 1;
    }

    const hoursInRange = Array.from({ length: openHourMax - openHourMin + 1 }, (_, i) => openHourMin + i);
    const byHour = hoursInRange.map((hour) => ({
      hour,
      count: countsByHour[hour].count,
    }));

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
