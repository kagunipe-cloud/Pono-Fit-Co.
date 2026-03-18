import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCartTables } from "@/lib/cart";
import { ensureDiscountsTable } from "@/lib/discounts";
import { ensureRecurringClassesTables, ensureClassesRecurringColumns, ensureClassOccurrencesClassId } from "@/lib/recurring-classes";
import { ensurePTSlotTables } from "@/lib/pt-slots";
import { getAdminMemberId } from "@/lib/admin";
import { computeCcFee } from "@/lib/cc-fees";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePrice(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** GET ?member_id= — Returns terminal charge breakdown (subtotal, cc_fee, tax, total). Admin only. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member_id = request.nextUrl.searchParams.get("member_id")?.trim();
  if (!member_id) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }

  const db = getDb();
  ensureCartTables(db);
  ensureRecurringClassesTables(db);
  ensureClassesRecurringColumns(db);
  ensureClassOccurrencesClassId(db);
  ensurePTSlotTables(db);

  const cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number; promo_code?: string | null } | undefined;
  if (!cart) {
    db.close();
    return NextResponse.json({ subtotal: 0, after_discount: 0, cc_fee: 0, tax: 0, total: 0 });
  }

  const rawItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as {
    product_type: string;
    product_id: number;
    quantity: number;
  }[];

  let subtotal = 0;
  for (const it of rawItems) {
    let price = "0";
    if (it.product_type === "membership_plan") {
      const row = db.prepare("SELECT price FROM membership_plans WHERE id = ?").get(it.product_id) as { price: string } | undefined;
      price = row?.price ?? "0";
    } else if (it.product_type === "pt_session") {
      const row = db.prepare("SELECT price FROM pt_sessions WHERE id = ?").get(it.product_id) as { price: string } | undefined;
      price = row?.price ?? "0";
    } else if (it.product_type === "class") {
      const row = db.prepare("SELECT price FROM classes WHERE id = ?").get(it.product_id) as { price: string } | undefined;
      price = row?.price ?? "0";
    } else if (it.product_type === "class_pack") {
      const row = db.prepare("SELECT price FROM class_pack_products WHERE id = ?").get(it.product_id) as { price: string } | undefined;
      price = row?.price ?? "0";
    } else if (it.product_type === "class_occurrence") {
      const occ = db.prepare(`
        SELECT COALESCE(c.price, r.price, '0') AS price
        FROM class_occurrences o
        LEFT JOIN classes c ON c.id = o.class_id
        LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
        WHERE o.id = ?
      `).get(it.product_id) as { price: string } | undefined;
      price = occ?.price ?? "0";
    } else if (it.product_type === "pt_pack") {
      const row = db.prepare("SELECT price FROM pt_pack_products WHERE id = ?").get(it.product_id) as { price: string } | undefined;
      price = row?.price ?? "0";
    }
    subtotal += parsePrice(price) * Math.max(1, it.quantity);
  }

  let percentOff = 0;
  const promoCode = cart.promo_code?.trim();
  if (promoCode) {
    ensureDiscountsTable(db);
    const discount = db.prepare("SELECT percent_off FROM discounts WHERE UPPER(TRIM(code)) = ?").get(promoCode.toUpperCase()) as { percent_off: number } | undefined;
    if (discount) percentOff = Math.min(100, Math.max(0, discount.percent_off));
  }
  db.close();

  const after_discount = Math.max(0, subtotal * (1 - percentOff / 100));
  const cc_fee = computeCcFee(after_discount);
  const baseAmount = after_discount + cc_fee;

  let tax = 0;
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  const taxRateId = process.env.STRIPE_TAX_RATE_ID?.trim();
  if (stripeSecret && taxRateId) {
    try {
      const stripe = new Stripe(stripeSecret);
      const taxRate = await stripe.taxRates.retrieve(taxRateId);
      const pct = Number(taxRate.percentage) || 0;
      tax = baseAmount * (pct / 100);
    } catch {
      /* ignore */
    }
  }

  const total = baseAmount + tax;

  return NextResponse.json({
    subtotal,
    after_discount,
    cc_fee,
    tax,
    total,
  });
}
