import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensureCartTables } from "../../../../../lib/cart";
import { getTrainerMemberId } from "../../../../../lib/admin";
import { getMemberIdFromSession } from "../../../../../lib/session";
import { normalizeUnitPriceOverrideInput } from "../../../../../lib/cart-line-prices";

export const dynamic = "force-dynamic";

/** DELETE — remove cart line */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const db = getDb();
    db.prepare("DELETE FROM cart_items WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to remove item" }, { status: 500 });
  }
}

/**
 * PATCH — Staff only. Body: { member_id, unit_price_override?, price_override_months?, price_override_indefinite? }
 * Clear staff pricing: send unit_price_override: null or "".
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  if (!(await getTrainerMemberId(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const member_id = String(body.member_id ?? "").trim();
  if (!member_id) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }

  const giftOnly =
    body.gift_recipient_email !== undefined &&
    body.unit_price_override === undefined &&
    body.price_override_months === undefined &&
    body.price_override_indefinite === undefined;

  if (giftOnly) {
    const sessionMemberId = await getMemberIdFromSession();
    const isStaff = !!(await getTrainerMemberId(request));
    if (sessionMemberId !== member_id && !isStaff) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const dbGift = getDb();
    ensureCartTables(dbGift);
    const giftRow = dbGift
      .prepare(
        `SELECT ci.id, ci.product_type
         FROM cart_items ci
         JOIN cart c ON c.id = ci.cart_id
         WHERE ci.id = ? AND c.member_id = ?`
      )
      .get(numericId, member_id) as { id: number; product_type: string } | undefined;

    if (!giftRow) {
      dbGift.close();
      return NextResponse.json({ error: "Cart item not found" }, { status: 404 });
    }
    if (giftRow.product_type !== "membership_plan") {
      dbGift.close();
      return NextResponse.json({ error: "Gift recipient email is only for membership lines" }, { status: 400 });
    }

    const raw = body.gift_recipient_email;
    let val: string | null = null;
    if (raw === null || raw === "") {
      val = null;
    } else {
      const s = String(raw).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        dbGift.close();
        return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
      }
      val = s;
    }
    dbGift.prepare("UPDATE cart_items SET gift_recipient_email = ? WHERE id = ?").run(val, numericId);
    const updatedGift = dbGift.prepare("SELECT * FROM cart_items WHERE id = ?").get(numericId);
    dbGift.close();
    return NextResponse.json(updatedGift);
  }

  const db = getDb();
  ensureCartTables(db);

  const row = db.prepare(
    `SELECT ci.id, ci.product_type, ci.product_id
     FROM cart_items ci
     JOIN cart c ON c.id = ci.cart_id
     WHERE ci.id = ? AND c.member_id = ?`
  ).get(numericId, member_id) as { id: number; product_type: string; product_id: number } | undefined;

  if (!row) {
    db.close();
    return NextResponse.json({ error: "Cart item not found" }, { status: 404 });
  }

  const existingRow = db.prepare("SELECT unit_price_override, price_override_months, price_override_indefinite FROM cart_items WHERE id = ?").get(numericId) as {
    unit_price_override: string | null;
    price_override_months: number | null;
    price_override_indefinite: number | null;
  };

  const plan =
    row.product_type === "membership_plan"
      ? (db.prepare("SELECT unit FROM membership_plans WHERE id = ?").get(row.product_id) as { unit: string } | undefined)
      : undefined;
  const isMonthlyMembership = row.product_type === "membership_plan" && plan?.unit === "Month";

  if (body.unit_price_override !== undefined && String(body.unit_price_override).trim() === "") {
    db.prepare(
      `UPDATE cart_items SET unit_price_override = NULL, price_override_months = NULL, price_override_indefinite = NULL WHERE id = ?`
    ).run(numericId);
    const updated = db.prepare("SELECT * FROM cart_items WHERE id = ?").get(numericId);
    db.close();
    return NextResponse.json(updated);
  }

  const unit_price_override =
    body.unit_price_override !== undefined
      ? normalizeUnitPriceOverrideInput(body.unit_price_override as string | null)
      : normalizeUnitPriceOverrideInput(existingRow.unit_price_override);

  if (unit_price_override == null) {
    db.close();
    return NextResponse.json({ error: "Set a valid unit_price_override or clear with empty string" }, { status: 400 });
  }

  let price_override_months: number | null = null;
  let price_override_indefinite = 0;

  if (isMonthlyMembership) {
    const indef = body.price_override_indefinite === true || body.price_override_indefinite === 1;
    if (indef) {
      price_override_indefinite = 1;
      price_override_months = null;
    } else {
      const m = body.price_override_months != null ? parseInt(String(body.price_override_months), 10) : 1;
      if (Number.isNaN(m) || m < 1) {
        db.close();
        return NextResponse.json({ error: "price_override_months must be >= 1 for monthly plans" }, { status: 400 });
      }
      price_override_months = m;
      price_override_indefinite = 0;
    }
  }

  db.prepare(
    `UPDATE cart_items SET unit_price_override = ?, price_override_months = ?, price_override_indefinite = ? WHERE id = ?`
  ).run(unit_price_override, price_override_months, price_override_indefinite, numericId);

  const updated = db.prepare("SELECT * FROM cart_items WHERE id = ?").get(numericId);
  db.close();
  return NextResponse.json(updated);
}
