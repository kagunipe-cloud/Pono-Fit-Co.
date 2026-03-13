import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensureDiscountsTable } from "../../../../../lib/discounts";
import { getAdminMemberId } from "../../../../../lib/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await getAdminMemberId(_request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureDiscountsTable(db);
    const row = db.prepare("SELECT * FROM discounts WHERE id = ?").get(id);
    db.close();
    if (!row) return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch discount" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const code = (body.code ?? "").trim().toUpperCase() || null;
    const percentOff = body.percent_off != null ? Math.min(100, Math.max(0, parseInt(String(body.percent_off), 10) || 0)) : undefined;
    const description = body.description !== undefined ? ((body.description ?? "").trim() || null) : undefined;
    const scope = body.scope !== undefined ? ((body.scope ?? "cart").trim() === "item" ? "item" : "cart") : undefined;

    const db = getDb();
    ensureDiscountsTable(db);
    const existing = db.prepare("SELECT id FROM discounts WHERE id = ?").get(id);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    }
    if (code) {
      const dup = db.prepare("SELECT id FROM discounts WHERE UPPER(TRIM(code)) = ? AND id != ?").get(code, id);
      if (dup) {
        db.close();
        return NextResponse.json({ error: "A discount with this code already exists" }, { status: 400 });
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    if (code !== null) { updates.push("code = ?"); values.push(code); }
    if (percentOff !== undefined) { updates.push("percent_off = ?"); values.push(percentOff); }
    if (description !== undefined) { updates.push("description = ?"); values.push(description); }
    if (scope !== undefined) { updates.push("scope = ?"); values.push(scope); }
    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE discounts SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM discounts WHERE id = ?").get(id);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update discount" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await getAdminMemberId(_request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureDiscountsTable(db);
    const result = db.prepare("DELETE FROM discounts WHERE id = ?").run(id);
    db.close();
    if (result.changes === 0) return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete discount" }, { status: 500 });
  }
}
