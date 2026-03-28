import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCartTables } from "@/lib/cart";
import { getEffectiveUnitPriceString } from "@/lib/cart-line-prices";
import { ensureDiscountsTable } from "@/lib/discounts";
import { ensurePTSlotTables } from "@/lib/pt-slots";
import { ensureRecurringClassesTables, ensureClassesRecurringColumns, ensureClassOccurrencesClassId } from "@/lib/recurring-classes";
import { getAdminMemberId } from "@/lib/admin";
import { computeCcFee } from "@/lib/cc-fees";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePrice(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** POST — Create PaymentIntent and process on reader (admin only). Body: { member_id, reader_id } */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const member_id = (body.member_id ?? "").trim();
  const reader_id = (body.reader_id ?? "").trim();
  if (!member_id || !reader_id) {
    return NextResponse.json({ error: "member_id and reader_id required" }, { status: 400 });
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
    return NextResponse.json({ error: "No cart for this member" }, { status: 404 });
  }

  const rawItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as {
    product_type: string;
    product_id: number;
    quantity: number;
    unit_price_override?: string | null;
  }[];

  let subtotal = 0;
  for (const it of rawItems) {
    const price = getEffectiveUnitPriceString(db, it);
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

  const afterDiscount = Math.max(0, subtotal * (1 - percentOff / 100));
  const ccFee = computeCcFee(afterDiscount);
  const baseAmount = afterDiscount + ccFee;

  let taxDollars = 0;
  const taxRateId = process.env.STRIPE_TAX_RATE_ID?.trim();
  if (taxRateId) {
    try {
      const stripe = new Stripe(stripeSecret);
      const taxRate = await stripe.taxRates.retrieve(taxRateId);
      const pct = Number(taxRate.percentage) || 0;
      taxDollars = baseAmount * (pct / 100);
    } catch (e) {
      console.warn("[terminal/charge] Could not fetch tax rate, skipping tax:", e);
    }
  }

  const totalDollars = baseAmount + taxDollars;
  const amountCents = Math.round(totalDollars * 100);
  if (amountCents < 50) {
    return NextResponse.json({ error: "Amount must be at least $0.50" }, { status: 400 });
  }

  try {
    const stripe = new Stripe(stripeSecret);
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      metadata: {
        member_id,
        ...(taxDollars > 0 ? { tax_amount: taxDollars.toFixed(2) } : {}),
      },
    });

    await stripe.terminal.readers.processPaymentIntent(reader_id, {
      payment_intent: pi.id,
    });

    return NextResponse.json({ payment_intent_id: pi.id });
  } catch (err) {
    console.error("[terminal/charge]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process payment" },
      { status: 500 }
    );
  }
}
