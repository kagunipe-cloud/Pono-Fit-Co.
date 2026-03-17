import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureOccupancySnapshotsTable } from "@/lib/occupancy";
import { getAppTimezone, getOpenHours } from "@/lib/db";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** GET: Occupancy analytics for charts. Query: days (default 30). Admin only. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Math.min(365, Math.max(7, parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10) || 30));

  try {
    const db = getDb();
    ensureOccupancySnapshotsTable(db);
    const tz = getAppTimezone(db, 1);
    const { openHourMin, openHourMax } = getOpenHours(db);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const rows = db.prepare(
      `SELECT recorded_at, count FROM occupancy_snapshots WHERE recorded_at >= ? ORDER BY recorded_at ASC`
    ).all(since) as { recorded_at: string; count: number }[];

    db.close();

    // Convert to gym timezone for grouping
    const byDayHour: Record<string, { sum: number; n: number }> = {};
    const byDate: Record<string, { sum: number; n: number }> = {};

    for (const row of rows) {
      const utcDate = new Date(row.recorded_at + "Z");
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false, day: "2-digit", month: "2-digit", year: "numeric" });
      const parts = formatter.formatToParts(utcDate);
      const dayName = parts.find((p) => p.type === "weekday")?.value ?? "?";
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      const day = (parts.find((p) => p.type === "day")?.value ?? "01").padStart(2, "0");
      const month = (parts.find((p) => p.type === "month")?.value ?? "01").padStart(2, "0");
      const year = parts.find((p) => p.type === "year")?.value ?? "?";

      const dayHourKey = `${dayName}-${hour}`;
      if (!byDayHour[dayHourKey]) byDayHour[dayHourKey] = { sum: 0, n: 0 };
      byDayHour[dayHourKey].sum += row.count;
      byDayHour[dayHourKey].n += 1;

      // Daily average: only during open hours (matches heatmap)
      const inOpenHours = hour >= openHourMin && hour <= openHourMax;
      if (inOpenHours) {
        const dateKey = `${year}-${month}-${day}`;
        if (!byDate[dateKey]) byDate[dateKey] = { sum: 0, n: 0 };
        byDate[dateKey].sum += row.count;
        byDate[dateKey].n += 1;
      }

    }

    const dayHourHeatmap = Object.entries(byDayHour).map(([key, v]) => {
      const [dayName, hourStr] = key.split("-");
      return {
        dayName,
        hour: parseInt(hourStr, 10),
        avgCount: v.n > 0 ? Math.round((v.sum / v.n) * 10) / 10 : 0,
        sampleCount: v.n,
      };
    });

    const hourRange = Array.from({ length: openHourMax - openHourMin + 1 }, (_, i) => openHourMin + i);
    const dayHourByDay = DAY_NAMES.map((dayName) => ({
      dayName,
      hours: hourRange.map((hour) => {
        const key = `${dayName}-${hour}`;
        const v = byDayHour[key];
        return { hour, avgCount: v && v.n > 0 ? Math.round((v.sum / v.n) * 10) / 10 : 0 };
      }),
    }));

    const dailyLine = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        avgCount: v.n > 0 ? Math.round((v.sum / v.n) * 10) / 10 : 0,
        sampleCount: v.n,
      }));

    // Weekly = average of daily averages (typical daily avg for that week), not avg of all snapshots
    const byWeekDailyAvg: Record<string, number[]> = {};
    for (const { date, avgCount } of dailyLine) {
      const weekStart = getWeekStartForDate(date, tz);
      if (!byWeekDailyAvg[weekStart]) byWeekDailyAvg[weekStart] = [];
      byWeekDailyAvg[weekStart].push(avgCount);
    }
    const weeklyLine = Object.entries(byWeekDailyAvg)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, avgs]) => ({
        week,
        avgCount: avgs.length > 0 ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 10) / 10 : 0,
        sampleCount: avgs.length,
      }));

    return NextResponse.json({
      dayHourHeatmap,
      dayHourByDay,
      dailyLine,
      weeklyLine,
      timezone: tz,
      days,
      open_hour_min: openHourMin,
      open_hour_max: openHourMax,
    });
  } catch (err) {
    console.error("[occupancy-analytics]", err);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}

function getWeekStart(d: Date, tz: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const parts = formatter.formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const dayOffset = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  const offset = dayOffset >= 0 ? dayOffset : 0;
  const monday = new Date(d.getTime() - offset * 24 * 60 * 60 * 1000);
  const p2 = formatter.formatToParts(monday);
  const y = p2.find((p) => p.type === "year")?.value ?? "";
  const m = p2.find((p) => p.type === "month")?.value ?? "";
  const day = p2.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

/** Get week start (Monday) for a date string YYYY-MM-DD. */
function getWeekStartForDate(dateStr: string, tz: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dObj = new Date(Date.UTC(y ?? 0, ((m ?? 1) - 1), d ?? 1, 12, 0, 0));
  return getWeekStart(dObj, tz);
}
