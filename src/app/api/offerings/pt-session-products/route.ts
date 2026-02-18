import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/** PT sessions with no date_time — bookable into any available slot. Recurring/scheduled sessions are not included. */
export async function GET() {
  try {
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db
      .prepare(
        "SELECT id, session_name, duration_minutes, price, trainer FROM pt_sessions WHERE date_time IS NULL ORDER BY duration_minutes ASC"
      )
      .all() as { id: number; session_name: string; duration_minutes: number; price: string; trainer: string | null }[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT session products" }, { status: 500 });
  }
}
