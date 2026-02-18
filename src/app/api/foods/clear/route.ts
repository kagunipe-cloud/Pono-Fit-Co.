import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureFoodsTable } from "@/lib/macros";

export const dynamic = "force-dynamic";

/** POST body: { confirm: true } — delete all foods. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== true) {
      return NextResponse.json({ error: "Send { \"confirm\": true } in the body to clear all foods" }, { status: 400 });
    }
    const db = getDb();
    ensureFoodsTable(db);
    const result = db.prepare("DELETE FROM foods").run();
    db.close();
    return NextResponse.json({ deleted: result.changes });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to clear foods" }, { status: 500 });
  }
}
