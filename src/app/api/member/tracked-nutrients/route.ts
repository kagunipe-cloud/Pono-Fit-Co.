import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { ensureFoodsTable } from "@/lib/macros";

export const dynamic = "force-dynamic";

/** GET — list nutrient_ids the current member chose to track (micros). */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const db = getDb();
    ensureFoodsTable(db);
    const rows = db
      .prepare("SELECT nutrient_id FROM member_tracked_nutrients WHERE member_id = ? ORDER BY nutrient_id")
      .all(memberId) as { nutrient_id: number }[];
    db.close();

    return NextResponse.json({
      nutrient_ids: rows.map((r) => r.nutrient_id),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to get tracked nutrients" }, { status: 500 });
  }
}

/** PUT — set which nutrients the member wants to track. Body: { nutrient_ids: number[] }. */
export async function PUT(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const nutrientIds = Array.isArray(body.nutrient_ids)
      ? body.nutrient_ids.filter((id: unknown) => typeof id === "number" && id > 0)
      : [];

    const db = getDb();
    ensureFoodsTable(db);
    db.prepare("DELETE FROM member_tracked_nutrients WHERE member_id = ?").run(memberId);
    const insert = db.prepare("INSERT INTO member_tracked_nutrients (member_id, nutrient_id) VALUES (?, ?)");
    for (const id of nutrientIds) {
      insert.run(memberId, id);
    }
    db.close();

    return NextResponse.json({ nutrient_ids: nutrientIds });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update tracked nutrients" }, { status: 500 });
  }
}
