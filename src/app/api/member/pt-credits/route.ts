import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { ensurePTSlotTables, getPTCreditBalances } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

/** GET: returns { 30: number, 60: number, 90: number } for the logged-in member. */
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
