import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { startOfDayInTz, endOfDayInTz } from "@/lib/app-timezone";
import { ensureWorkoutTables } from "@/lib/workouts-server";

export const dynamic = "force-dynamic";

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** UTC-ish bounds for SQLite `datetime('now')` style timestamps (YYYY-MM-DD HH:MM:SS). */
function workoutFinishedBounds(from: string, to: string, tz: string): { fromSql: string; toSql: string } {
  const fromSql = startOfDayInTz(from, tz).replace("T", " ").slice(0, 19);
  const toSql = endOfDayInTz(to, tz).replace("T", " ").slice(0, 19);
  return { fromSql, toSql };
}

/** GET: Per-member lift volume (sum of reps × weight on finished workouts). Admin only.
 * Query: from=YYYY-MM-DD, to=YYYY-MM-DD (inclusive, gym timezone calendar days).
 * Single day: set from and to to the same date. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();

  if (!from || !to || !isYmd(from) || !isYmd(to)) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)." }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "from must be on or before to." }, { status: 400 });
  }

  try {
    const db = getDb();
    const tz = getAppTimezone(db);
    ensureWorkoutTables(db);
    const { fromSql, toSql } = workoutFinishedBounds(from, to, tz);

    const rows = db
      .prepare(
        `SELECT m.member_id, m.first_name, m.last_name,
                SUM((
                  SELECT COALESCE(SUM(COALESCE(ws.reps, 0) * COALESCE(ws.weight_kg, 0)), 0)
                  FROM workout_exercises we
                  JOIN workout_sets ws ON ws.workout_exercise_id = we.id
                  WHERE we.workout_id = w.id AND we.type = 'lift'
                )) AS total_volume,
                COUNT(*) AS workout_count
         FROM workouts w
         INNER JOIN members m ON m.member_id = w.member_id
         WHERE w.finished_at IS NOT NULL
           AND w.finished_at >= ?
           AND w.finished_at <= ?
         GROUP BY m.member_id, m.first_name, m.last_name
         ORDER BY total_volume DESC, m.last_name COLLATE NOCASE, m.first_name COLLATE NOCASE`
      )
      .all(fromSql, toSql) as {
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      total_volume: number;
      workout_count: number;
    }[];

    db.close();

    const members = rows.map((r) => ({
      member_id: r.member_id,
      first_name: r.first_name,
      last_name: r.last_name,
      total_volume: Number(r.total_volume) || 0,
      finished_workout_count: Number(r.workout_count) || 0,
    }));

    const grand_total_volume = members.reduce((s, m) => s + m.total_volume, 0);

    return NextResponse.json({
      timezone: tz,
      from,
      to,
      members,
      grand_total_volume,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to build report." }, { status: 500 });
  }
}
