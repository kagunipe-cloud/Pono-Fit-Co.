import { NextResponse } from "next/server";
import { getDb } from "../../../lib/db";
import { ensureTrainersTable } from "../../../lib/trainers";

export const dynamic = "force-dynamic";

/** GET — list trainers (member_id, display_name) for dropdowns. Used by members to filter PT by trainer and by admin to block time. */
export async function GET() {
  try {
    const db = getDb();
    ensureTrainersTable(db);
    const rows = db.prepare(`
      SELECT t.member_id, m.first_name, m.last_name
      FROM trainers t
      JOIN members m ON m.member_id = t.member_id
      ORDER BY m.last_name ASC, m.first_name ASC
    `).all() as { member_id: string; first_name: string | null; last_name: string | null }[];
    db.close();
    const list = rows.map((r) => ({
      member_id: r.member_id,
      display_name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id,
    }));
    return NextResponse.json(list);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch trainers" }, { status: 500 });
  }
}
