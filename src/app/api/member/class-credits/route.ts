import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "../../../../lib/recurring-classes";
import { getMemberIdFromSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = getDb();
    ensureRecurringClassesTables(db);
    const balance = getMemberCreditBalance(db, memberId);
    db.close();
    return NextResponse.json({ balance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to get credits" }, { status: 500 });
  }
}
