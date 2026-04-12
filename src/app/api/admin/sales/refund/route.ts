import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureSalesStripePaymentIntentColumn } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parseGrandTotalDollars(raw: string | null | undefined): number {
  if (raw == null || String(raw).trim() === "") return 0;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function isAlreadyRefundedStripeError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === "charge_already_refunded" ||
    msg.includes("already been refunded") ||
    msg.includes("has already been refunded")
  );
}

/** POST { sales_id: string } — Admin only. Refunds the Stripe PaymentIntent (if stored), then marks sale refunded and cancels subscriptions linked to this sale. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeSecret) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });
  }

  try {
    const body = (await request.json()) as {
      sales_id?: string;
      /** If true, only update the app DB (use when you already refunded in Stripe, e.g. sale has no payment intent on file). */
      record_refund_only?: boolean;
    };
    const sales_id = (body.sales_id ?? "").trim();
    const recordRefundOnly = body.record_refund_only === true;
    if (!sales_id) {
      return NextResponse.json({ error: "sales_id required" }, { status: 400 });
    }
    const db = getDb();
    ensureSalesStripePaymentIntentColumn(db);
    const sale = db
      .prepare(
        "SELECT sales_id, member_id, status, grand_total, stripe_payment_intent_id FROM sales WHERE sales_id = ?"
      )
      .get(sales_id) as
      | {
          sales_id: string;
          member_id: string;
          status: string;
          grand_total: string | null;
          stripe_payment_intent_id: string | null;
        }
      | undefined;
    if (!sale) {
      db.close();
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }
    if (sale.status === "Refunded") {
      db.close();
      return NextResponse.json({ error: "Sale is already refunded" }, { status: 400 });
    }

    const amountDollars = parseGrandTotalDollars(sale.grand_total);
    const pi = sale.stripe_payment_intent_id?.trim() ?? "";

    if (amountDollars > 0 && recordRefundOnly && pi) {
      db.close();
      return NextResponse.json(
        { error: "record_refund_only is only for sales with no stored Stripe payment (refund in Stripe first if a charge exists)." },
        { status: 400 }
      );
    }

    const skipStripeBecauseRecordOnly = amountDollars > 0 && recordRefundOnly && !pi;

    if (amountDollars > 0 && !skipStripeBecauseRecordOnly) {
      if (!pi) {
        db.close();
        return NextResponse.json(
          {
            error:
              "This paid sale has no Stripe payment ID on file (e.g. renewals before we started saving them). Refund in Stripe if needed, then use “Record refund only” in the app.",
          },
          { status: 409 }
        );
      }

      const stripe = new Stripe(stripeSecret);
      try {
        await stripe.refunds.create({
          payment_intent: pi,
        });
      } catch (err) {
        if (!isAlreadyRefundedStripeError(err)) {
          db.close();
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[sales/refund] Stripe refund failed", sales_id, err);
          return NextResponse.json(
            { error: `Stripe could not refund: ${msg}` },
            { status: 502 }
          );
        }
        /* Already refunded in Stripe — sync app state below. */
      }
    }

    db.prepare("UPDATE sales SET status = ? WHERE sales_id = ?").run("Refunded", sales_id);
    db.prepare("UPDATE subscriptions SET status = ? WHERE sales_id = ?").run("Cancelled", sales_id);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sales/refund]", err);
    return NextResponse.json({ error: "Failed to refund sale" }, { status: 500 });
  }
}
