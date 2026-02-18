import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — open slot bookings in range (for schedule). */
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from")?.trim();
  const to = request.nextUrl.searchParams.get("to")?.trim();
  if (!from || !to) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) required" }, { status: 400 });
  }
  try {
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db
      .prepare(
        `SELECT ob.id, ob.member_id, ob.guest_name, ob.occurrence_date, ob.start_time, ob.duration_minutes, ob.pt_session_id, ob.payment_type,
                m.first_name, m.last_name, p.session_name, p.trainer
         FROM pt_open_bookings ob
         LEFT JOIN members m ON m.member_id = ob.member_id
         LEFT JOIN pt_sessions p ON p.id = ob.pt_session_id
         WHERE ob.occurrence_date >= ? AND ob.occurrence_date <= ?
         ORDER BY ob.occurrence_date, ob.start_time`
      )
      .all(from, to) as { id: number; member_id: string; guest_name: string | null; occurrence_date: string; start_time: string; duration_minutes: number; pt_session_id: number; first_name: string | null; last_name: string | null; session_name: string | null; trainer: string | null }[];
    const out = rows.map((r) => {
      const member_name = (r.guest_name && r.guest_name.trim()) ? r.guest_name.trim() : ([r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id || "—");
      return {
        id: r.id,
        member_id: r.member_id,
        occurrence_date: r.occurrence_date,
        start_time: r.start_time,
        duration_minutes: r.duration_minutes,
        pt_session_id: r.pt_session_id,
        payment_type: r.payment_type,
        member_name,
        session_name: r.session_name ?? "PT",
        trainer: r.trainer ?? null,
      };
    });
    db.close();
    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch open bookings" }, { status: 500 });
  }
}
