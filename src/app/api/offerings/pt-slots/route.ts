import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/** Parse date_time to YYYY-MM-DD for filtering. */
function parseDate(dt: string | null): string | null {
  if (!dt || !dt.trim()) return null;
  const s = dt.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&member_id= (optional)
 * Returns PT sessions in range with booking status.
 * - If member_id provided: only returns slots that are available OR booked by this member. Each has booked_by_me: boolean.
 * - If member_id not provided (staff): returns all slots with booked: boolean, booked_member_id, booked_member_name.
 */
export async function GET(request: NextRequest) {
  try {
    const from = request.nextUrl.searchParams.get("from")?.trim();
    const to = request.nextUrl.searchParams.get("to")?.trim();
    const member_id = request.nextUrl.searchParams.get("member_id")?.trim() || null;

    if (!from || !to) {
      return NextResponse.json({ error: "from and to (YYYY-MM-DD) required" }, { status: 400 });
    }

    const db = getDb();
    ensurePTSlotTables(db);

    const rows = db.prepare(`
      SELECT p.id, p.product_id, p.session_name, p.session_duration, p.date_time, p.price, p.trainer,
             p.duration_minutes,
             b.member_id AS booked_member_id,
             m.first_name || ' ' || m.last_name AS booked_member_name
      FROM pt_sessions p
      LEFT JOIN pt_slot_bookings b ON b.pt_session_id = p.id
      LEFT JOIN members m ON m.member_id = b.member_id
      ORDER BY p.date_time ASC
    `).all() as (Record<string, unknown> & { date_time: string | null; booked_member_id: string | null; booked_member_name: string | null })[];

    const filtered = rows.filter((r) => {
      const date = parseDate(r.date_time);
      if (!date) return false;
      return date >= from && date <= to;
    });

    const result = filtered.map((r) => {
      const booked = !!r.booked_member_id;
      const booked_by_me = member_id ? r.booked_member_id === member_id : false;
      if (member_id) {
        if (booked && !booked_by_me) return null;
        return {
          id: r.id,
          product_id: r.product_id,
          session_name: r.session_name,
          session_duration: r.session_duration,
          date_time: r.date_time,
          price: r.price,
          trainer: r.trainer,
          duration_minutes: r.duration_minutes ?? 60,
          booked,
          booked_by_me,
        };
      }
      return {
        id: r.id,
        product_id: r.product_id,
        session_name: r.session_name,
        session_duration: r.session_duration,
        date_time: r.date_time,
        price: r.price,
        trainer: r.trainer,
        duration_minutes: r.duration_minutes ?? 60,
        booked,
        booked_member_id: r.booked_member_id ?? null,
        booked_member_name: r.booked_member_name ?? null,
      };
    }).filter(Boolean);

    db.close();
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT slots" }, { status: 500 });
  }
}
