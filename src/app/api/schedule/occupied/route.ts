import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

function parseTimeToMinutes(t: string | null): number {
  if (!t || !String(t).trim()) return 0;
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return (h % 24) * 60 + m;
}

function parseDateTime(dt: string | null): { date: string; timeMinutes: number } | null {
  if (!dt || !dt.trim()) return null;
  const s = dt.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{1,2}):(\d{2})/);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    const timeMinutes = (parseInt(iso[4], 10) % 24) * 60 + (parseInt(iso[5], 10) || 0);
    return { date, timeMinutes };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toISOString().slice(0, 10);
  const timeMinutes = d.getHours() * 60 + d.getMinutes();
  return { date, timeMinutes };
}

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD. Returns { classes: [...], pt: [...] } for conflict checks. PT occupied slots come from pt_open_bookings (recurring bookings) and legacy pt_sessions with date_time. */
export async function GET(request: NextRequest) {
  try {
    const from = request.nextUrl.searchParams.get("from")?.trim();
    const to = request.nextUrl.searchParams.get("to")?.trim();
    if (!from || !to) {
      return NextResponse.json({ error: "from and to (YYYY-MM-DD) required" }, { status: 400 });
    }

    const db = getDb();
    ensureRecurringClassesTables(db);
    ensurePTSlotTables(db);

    const classRows = db.prepare(`
      SELECT id, occurrence_date, occurrence_time FROM class_occurrences
      WHERE occurrence_date >= ? AND occurrence_date <= ?
        AND (class_id IS NOT NULL OR recurring_class_id IS NOT NULL)
    `).all(from, to) as { id: number; occurrence_date: string; occurrence_time: string }[];

    const ptSessionRows = db.prepare("SELECT id, date_time FROM pt_sessions").all() as { id: number; date_time: string | null }[];
    const ptOpenRows = db.prepare(`
      SELECT id, occurrence_date, start_time FROM pt_open_bookings
      WHERE occurrence_date >= ? AND occurrence_date <= ?
    `).all(from, to) as { id: number; occurrence_date: string; start_time: string }[];
    db.close();

    const classes = classRows.map((r) => ({
      id: r.id,
      date: r.occurrence_date,
      timeMinutes: parseTimeToMinutes(r.occurrence_time),
    }));

    const ptFromSessions = ptSessionRows
      .map((r) => {
        const parsed = parseDateTime(r.date_time);
        if (!parsed || parsed.date < from || parsed.date > to) return null;
        return { id: r.id, date: parsed.date, timeMinutes: parsed.timeMinutes };
      })
      .filter((x): x is { id: number; date: string; timeMinutes: number } => x !== null);

    const ptFromOpen = ptOpenRows.map((r) => ({
      id: r.id,
      date: r.occurrence_date,
      timeMinutes: parseTimeToMinutes(r.start_time),
    }));

    const pt = [...ptFromSessions, ...ptFromOpen];

    return NextResponse.json({ classes, pt });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch occupied slots" }, { status: 500 });
  }
}
