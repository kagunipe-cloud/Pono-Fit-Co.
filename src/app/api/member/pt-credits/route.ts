import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { ensurePTSlotTables, getPTCreditBalances } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/** GET: PT credit balances keyed by duration_minutes (e.g. 30, 60, 90, 120). Always includes 30/60/90 at 0 when unused; other durations appear when the member has those credits. */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const balances = getPTCreditBalances(db, memberId);
    db.close();
    return NextResponse.json(balances);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT credits" }, { status: 500 });
  }
}
