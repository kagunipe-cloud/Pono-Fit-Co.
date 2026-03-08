import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&trainer_member_id= (optional) — open slot bookings in range. If trainer_member_id, only bookings assigned to that trainer. */
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from")?.trim();
  const to = request.nextUrl.searchParams.get("to")?.trim();
  const trainer_member_id = request.nextUrl.searchParams.get("trainer_member_id")?.trim() || null;
  if (!from || !to) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) required" }, { status: 400 });
  }
  try {
    const db = getDb();
    ensurePTSlotTables(db);
    const sql = trainer_member_id
      ? `SELECT ob.id, ob.member_id, ob.guest_name, ob.occurrence_date, ob.start_time, ob.duration_minutes, ob.pt_session_id, ob.payment_type, ob.trainer_member_id,
                m.first_name, m.last_name, p.session_name, p.trainer,
                tm.first_name AS trainer_first_name, tm.last_name AS trainer_last_name
         FROM pt_open_bookings ob
         LEFT JOIN members m ON m.member_id = ob.member_id
         LEFT JOIN pt_sessions p ON p.id = ob.pt_session_id
         LEFT JOIN members tm ON tm.member_id = ob.trainer_member_id
         WHERE ob.occurrence_date >= ? AND ob.occurrence_date <= ? AND ob.trainer_member_id = ?
         ORDER BY ob.occurrence_date, ob.start_time`
      : `SELECT ob.id, ob.member_id, ob.guest_name, ob.occurrence_date, ob.start_time, ob.duration_minutes, ob.pt_session_id, ob.payment_type, ob.trainer_member_id,
                m.first_name, m.last_name, p.session_name, p.trainer,
                tm.first_name AS trainer_first_name, tm.last_name AS trainer_last_name
         FROM pt_open_bookings ob
         LEFT JOIN members m ON m.member_id = ob.member_id
         LEFT JOIN pt_sessions p ON p.id = ob.pt_session_id
         LEFT JOIN members tm ON tm.member_id = ob.trainer_member_id
         WHERE ob.occurrence_date >= ? AND ob.occurrence_date <= ?
         ORDER BY ob.occurrence_date, ob.start_time`;
    const rows = db
      .prepare(sql)
      .all(...(trainer_member_id ? [from, to, trainer_member_id] : [from, to])) as {
      id: number;
      member_id: string;
      guest_name: string | null;
      occurrence_date: string;
      start_time: string;
      duration_minutes: number;
      pt_session_id: number;
      payment_type: string | null;
      trainer_member_id: string | null;
      first_name: string | null;
      last_name: string | null;
      session_name: string | null;
      trainer: string | null;
      trainer_first_name: string | null;
      trainer_last_name: string | null;
    }[];
    const out = rows.map((r) => {
      const member_name = (r.guest_name && r.guest_name.trim()) ? r.guest_name.trim() : ([r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id || "—");
      const trainer_name = r.trainer_member_id ? ([r.trainer_first_name, r.trainer_last_name].filter(Boolean).join(" ").trim() || null) : null;
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
        trainer_member_id: r.trainer_member_id ?? null,
        trainer_name,
      };
    });
    db.close();
    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch open bookings" }, { status: 500 });
  }
}
