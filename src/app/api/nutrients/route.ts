import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureFoodsTable } from "@/lib/macros";

export const dynamic = "force-dynamic";

/** GET — list all nutrients we support (for "choose which to track" and display). */
export async function GET() {
  try {
    const db = getDb();
    ensureFoodsTable(db);
    const rows = db
      .prepare("SELECT id, name, unit_name FROM nutrients ORDER BY id")
      .all() as { id: number; name: string; unit_name: string | null }[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to list nutrients" }, { status: 500 });
  }
}
