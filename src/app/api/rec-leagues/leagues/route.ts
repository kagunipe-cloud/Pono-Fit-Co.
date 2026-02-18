import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../lib/rec-leagues";

export const dynamic = "force-dynamic";

/** GET: list all leagues (public). */
export async function GET() {
  try {
    const db = getDb();
    ensureRecLeaguesTables(db);
    const rows = db.prepare("SELECT id, name, season FROM rec_leagues ORDER BY name ASC").all();
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch leagues" },
      { status: 500 }
    );
  }
}
