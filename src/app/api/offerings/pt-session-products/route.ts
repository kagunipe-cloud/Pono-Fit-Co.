import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { getTrainerMemberIdByDisplayName } from "../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

/** PT sessions with no date_time — bookable into any available slot. Recurring/scheduled sessions are not included. Includes trainer_member_id when session has a trainer. */
export async function GET() {
  try {
    const db = getDb();
    ensurePTSlotTables(db);
    const rows = db
      .prepare(
        "SELECT id, session_name, duration_minutes, price, trainer FROM pt_sessions WHERE date_time IS NULL ORDER BY duration_minutes ASC"
      )
      .all() as { id: number; session_name: string; duration_minutes: number; price: string; trainer: string | null }[];
    const out = rows.map((r) => ({
      ...r,
      trainer_member_id: r.trainer ? getTrainerMemberIdByDisplayName(db, r.trainer) : null,
    }));
    db.close();
    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT session products" }, { status: 500 });
  }
}
