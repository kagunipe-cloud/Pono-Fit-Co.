import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureDiscountsTable } from "../../../../lib/discounts";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = getDb();
    ensureDiscountsTable(db);
    let rows = db.prepare("SELECT * FROM discounts ORDER BY code ASC").all() as { id: number; code: string; percent_off: number; description: string | null; scope: string }[];
    if (rows.length === 0) {
      const defaults = [
        { code: "KUKEA", percent_off: 10, description: "10% off" },
        { code: "KUPUNA", percent_off: 15, description: "15% off" },
        { code: "OHANA", percent_off: 20, description: "20% off" },
      ];
      for (const d of defaults) {
        try {
          db.prepare("INSERT INTO discounts (code, percent_off, description, scope) VALUES (?, ?, ?, 'cart')").run(d.code, d.percent_off, d.description);
        } catch {
          /* ignore if exists */
        }
      }
      rows = db.prepare("SELECT * FROM discounts ORDER BY code ASC").all() as { id: number; code: string; percent_off: number; description: string | null; scope: string }[];
    }
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch discounts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const code = (body.code ?? "").trim().toUpperCase() || null;
    const percentOff = Math.min(100, Math.max(0, parseInt(String(body.percent_off ?? 0), 10) || 0));
    const description = (body.description ?? "").trim() || null;
    const scope = (body.scope ?? "cart").trim() === "item" ? "item" : "cart";

    if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 });

    const db = getDb();
    ensureDiscountsTable(db);
    const existing = db.prepare("SELECT 1 FROM discounts WHERE UPPER(TRIM(code)) = ?").get(code);
    if (existing) {
      db.close();
      return NextResponse.json({ error: "A discount with this code already exists" }, { status: 400 });
    }
    const result = db.prepare(
      "INSERT INTO discounts (code, percent_off, description, scope) VALUES (?, ?, ?, ?)"
    ).run(code, percentOff, description, scope);
    const row = db.prepare("SELECT * FROM discounts WHERE id = ?").get(result.lastInsertRowid);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create discount" }, { status: 500 });
  }
}
