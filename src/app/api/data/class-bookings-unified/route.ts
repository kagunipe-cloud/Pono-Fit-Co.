import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

type BookingRow = {
  source: string;
  id: number | string;
  member_id?: string;
  recurring_class_id?: number | null;
  member_name: string;
  transaction_datetime: string;
  session_datetime: string;
  session_sort_key: string;
  status: "active" | "fulfilled";
  class_name: string;
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
    ensureRecurringClassesTables(db);

    const rows: BookingRow[] = [];

    // occurrence_bookings (credit-based recurring)
    const occRows = db.prepare(`
      SELECT ob.id, ob.member_id, ob.created_at,
             o.occurrence_date, o.occurrence_time, o.recurring_class_id,
             COALESCE(c.class_name, r.name) AS class_name
      FROM occurrence_bookings ob
      JOIN class_occurrences o ON o.id = ob.class_occurrence_id
      LEFT JOIN classes c ON c.id = o.class_id
      LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
    `).all() as { id: number; member_id: string; created_at: string | null; occurrence_date: string; occurrence_time: string | null; recurring_class_id: number | null; class_name: string | null }[];

    for (const r of occRows) {
      const m = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(r.member_id) as { first_name: string | null; last_name: string | null } | undefined;
      const member_name = m ? [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || r.member_id : r.member_id;
      const time = (r.occurrence_time ?? "").trim();
      const session_key = `${r.occurrence_date}T${time || "00:00:00"}`;
      const status = session_key <= nowKey ? "fulfilled" : "active";
      rows.push({
        source: "Occurrence",
        id: r.id,
        member_id: r.member_id,
        recurring_class_id: r.recurring_class_id ?? null,
        member_name,
        transaction_datetime: r.created_at ?? "—",
        session_datetime: time ? `${r.occurrence_date} ${time}` : r.occurrence_date,
        session_sort_key: session_key,
        status,
        class_name: r.class_name ?? "Class",
        payment_type: "—",
        cancel_type: "occurrence",
        cancel_id: r.id,
      });
    }

    // class_bookings (cart one-off)
    try {
      const classRows = db.prepare(`
        SELECT b.id, b.class_booking_id, b.member_id, b.booking_date, c.class_name, c.date, c.time
        FROM class_bookings b
        LEFT JOIN classes c ON c.product_id = b.product_id
      `).all() as { id: number; class_booking_id: string; member_id: string; booking_date: string | null; class_name: string | null; date: string | null; time: string | null }[];

      for (const r of classRows) {
        const date = r.date ?? "";
        const time = r.time ?? "";
        if (!date || !time) {
          /** Credit-only cart rows: balances live on Open Credits (class_credit_ledger), not this list. */
          continue;
        }
        const m = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(r.member_id) as { first_name: string | null; last_name: string | null } | undefined;
        const member_name = m ? [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || r.member_id : r.member_id;
        const session_key = `${date}T${time}`;
        const status = session_key <= nowKey ? "fulfilled" : "active";
        rows.push({
          source: "Cart (one-time)",
          id: r.class_booking_id ?? r.id,
          member_name,
          transaction_datetime: r.booking_date ?? "—",
          session_datetime: `${date} ${time}`,
          session_sort_key: session_key,
          status,
          class_name: r.class_name ?? "Class",
          payment_type: "—",
        });
      }
    } catch {
      /* class_bookings may not exist */
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
          row.class_name.toLowerCase().includes(lower) ||
          row.source.toLowerCase().includes(lower)
      );
      db.close();
      return NextResponse.json(filtered);
    }

    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class bookings" }, { status: 500 });
  }
}
