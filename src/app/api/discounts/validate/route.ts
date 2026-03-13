import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureDiscountsTable } from "../../../../lib/discounts";

export const dynamic = "force-dynamic";

/** GET ?code=KUKEA — Validate promo code. Returns { valid: true, percent_off, code, description } or 404. */
export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 });

  try {
    const db = getDb();
    ensureDiscountsTable(db);
    const row = db.prepare("SELECT id, code, percent_off, description, scope FROM discounts WHERE UPPER(TRIM(code)) = ?").get(code) as
      | { id: number; code: string; percent_off: number; description: string | null; scope: string }
      | undefined;
    db.close();
    if (!row) return NextResponse.json({ error: "Invalid or expired promo code" }, { status: 404 });
    return NextResponse.json({
      valid: true,
      code: row.code,
      percent_off: row.percent_off,
      description: row.description ?? undefined,
      scope: row.scope ?? "cart",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to validate" }, { status: 500 });
  }
}
