import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";

export const dynamic = "force-dynamic";

/** GET — Returns whether bootstrap (create first admin) is needed. Only when DB has no members. */
export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT COUNT(*) AS n FROM members").get() as { n: number };
    db.close();
    return NextResponse.json({ needs_bootstrap: row.n === 0 });
  } catch {
    return NextResponse.json({ needs_bootstrap: false });
  }
}
