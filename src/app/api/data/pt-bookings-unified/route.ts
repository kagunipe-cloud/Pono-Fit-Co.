import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

type BookingRow = {
  source: string;
  id: number | string;
  member_id?: string;
  pt_session_id?: number | null;
  trainer?: string | null;
  recurring_group_id?: string | null;
  member_name: string;
  transaction_datetime: string;
  session_datetime: string;
  session_sort_key: string; // for sorting: "9999-99-99T99:99" for no session (bottom of active)
  status: "active" | "fulfilled";
  session_name: string;
  payment_type: string;
  cancel_type?: string;
  cancel_id?: number;
};

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const now = new Date();
  const nowKey = `${now.toISOString().slice(0, 10)}T${now.toTimeString().slice(0, 8)}`;

  try {
    const db = getDb();
    ensurePTSlotTables(db);

    const rows: BookingRow[] = [];

    // pt_open_bookings
    const openRows = db.prepare(`
      SELECT ob.id, ob.member_id, ob.guest_name, ob.occurrence_date, ob.start_time, ob.duration_minutes, ob.created_at, ob.payment_type, ob.pt_session_id, ob.recurring_group_id,
             m.first_name, m.last_name, p.session_name
      FROM pt_open_bookings ob
      LEFT JOIN members m ON m.member_id = ob.member_id
      LEFT JOIN pt_sessions p ON p.id = ob.pt_session_id
    `).all() as { id: number; member_id: string; guest_name: string | null; occurrence_date: string; start_time: string; duration_minutes: number; created_at: string | null; payment_type: string | null; pt_session_id: number; recurring_group_id: string | null; first_name: string | null; last_name: string | null; session_name: string | null }[];

    for (const r of openRows) {
      const member_name = (r.guest_name && r.guest_name.trim()) ? r.guest_name.trim() : ([r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id || "—");
      const session_key = `${r.occurrence_date}T${r.start_time}`;
      const status = session_key <= nowKey ? "fulfilled" : "active";
      rows.push({
        source: "Open",
        id: r.id,
        member_id: r.member_id || (r.guest_name ? `guest:${r.guest_name}` : undefined),
        pt_session_id: r.pt_session_id ?? null,
        recurring_group_id: r.recurring_group_id ?? null,
        member_name,
        transaction_datetime: r.created_at ?? "—",
        session_datetime: `${r.occurrence_date} ${r.start_time}`,
        session_sort_key: session_key,
        status,
        session_name: r.session_name ?? "PT",
        payment_type: r.payment_type ?? "—",
        cancel_type: "open",
        cancel_id: r.id,
      });
    }

    // pt_trainer_specific_bookings
    const tsRows = db.prepare(`
      SELECT b.id, b.member_id, b.occurrence_date, b.start_time, b.session_duration_minutes, b.created_at, b.payment_type, b.recurring_group_id,
             m.first_name, m.last_name, a.trainer
      FROM pt_trainer_specific_bookings b
      JOIN trainer_availability a ON a.id = b.trainer_availability_id
      LEFT JOIN members m ON m.member_id = b.member_id
    `).all() as { id: number; member_id: string; occurrence_date: string; start_time: string; session_duration_minutes: number; created_at: string | null; payment_type: string | null; recurring_group_id: string | null; first_name: string | null; last_name: string | null; trainer: string | null }[];

    for (const r of tsRows) {
      const member_name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id || "—";
      const session_key = `${r.occurrence_date}T${r.start_time}`;
      const status = session_key <= nowKey ? "fulfilled" : "active";
      rows.push({
        source: "Trainer-specific",
        id: r.id,
        member_id: r.member_id,
        trainer: r.trainer ?? null,
        recurring_group_id: r.recurring_group_id ?? null,
        member_name,
        transaction_datetime: r.created_at ?? "—",
        session_datetime: `${r.occurrence_date} ${r.start_time}`,
        session_sort_key: session_key,
        status,
        session_name: `${r.trainer ?? "—"} PT`,
        payment_type: r.payment_type ?? "—",
        cancel_type: "trainer_specific",
        cancel_id: r.id,
      });
    }

    // pt_slot_bookings (one-time slot)
    try {
      const slotRows = db.prepare(`
        SELECT b.id, b.member_id, p.session_name, p.date_time
        FROM pt_slot_bookings b
        LEFT JOIN pt_sessions p ON p.id = b.pt_session_id
        WHERE p.date_time IS NOT NULL
      `).all() as { id: number; member_id: string; session_name: string | null; date_time: string | null }[];

      for (const r of slotRows) {
        const m = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(r.member_id) as { first_name: string | null; last_name: string | null } | undefined;
        const member_name = m ? [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || r.member_id : r.member_id;
        const dt = r.date_time ?? "";
        const session_key = dt.replace(" ", "T").slice(0, 16) || "9999-99-99T99:99";
        const status = session_key <= nowKey ? "fulfilled" : "active";
        rows.push({
          source: "Slot",
          id: r.id,
          member_name,
          transaction_datetime: "—",
          session_datetime: dt || "—",
          session_sort_key: session_key,
          status,
          session_name: r.session_name ?? "PT",
          payment_type: "—",
          cancel_type: "slot",
          cancel_id: r.id,
        });
      }
    } catch {
      /* pt_slot_bookings may not exist */
    }

    // pt_bookings (cart one-time or credit)
    try {
      const ptBookRows = db.prepare(`
        SELECT b.id, b.pt_booking_id, b.member_id, b.booking_date, p.session_name, p.date_time
        FROM pt_bookings b
        LEFT JOIN pt_sessions p ON p.product_id = b.product_id
      `).all() as { id: number; pt_booking_id: string; member_id: string; booking_date: string | null; session_name: string | null; date_time: string | null }[];

      for (const r of ptBookRows) {
        const session_dt = r.date_time ?? "";
        if (!session_dt) {
          /** Credit-only cart rows: balances live on Open Credits (pt_credit_ledger), not this list. */
          continue;
        }
        const m = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(r.member_id) as { first_name: string | null; last_name: string | null } | undefined;
        const member_name = m ? [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || r.member_id : r.member_id;
        const session_key = session_dt.replace(" ", "T").slice(0, 16);
        const status = session_key <= nowKey ? "fulfilled" : "active";
        rows.push({
          source: "Cart (one-time)",
          id: r.pt_booking_id ?? r.id,
          member_name,
          transaction_datetime: r.booking_date ?? "—",
          session_datetime: session_dt,
          session_sort_key: session_key,
          status,
          session_name: r.session_name ?? "PT",
          payment_type: "—",
        });
      }
    } catch {
      /* pt_bookings may not exist */
    }

    // Sort: Active first (session ASC, no-session at bottom), then Fulfilled (session DESC)
    rows.sort((a, b) => {
      const aActive = a.status === "active";
      const bActive = b.status === "active";
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      if (aActive && bActive) {
        return a.session_sort_key.localeCompare(b.session_sort_key);
      }
      return b.session_sort_key.localeCompare(a.session_sort_key);
    });

    if (q) {
      const lower = q.toLowerCase();
      const filtered = rows.filter(
        (row) =>
          row.member_name.toLowerCase().includes(lower) ||
          row.session_datetime.toLowerCase().includes(lower) ||
          row.session_name.toLowerCase().includes(lower) ||
          row.source.toLowerCase().includes(lower)
      );
      db.close();
      return NextResponse.json(filtered);
    }

    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT bookings" }, { status: 500 });
  }
}
