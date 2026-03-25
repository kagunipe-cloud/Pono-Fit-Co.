import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "../../../../lib/db";
import { ensureRecurringClassesTables, ensureClassesRecurringColumns, ensureClassOccurrencesClassId } from "../../../../lib/recurring-classes";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { ensureDiscountsTable } from "../../../../lib/discounts";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getTrainerMemberId } from "../../../../lib/admin";
import { computeCcFee } from "../../../../lib/cc-fees";
import { stripeCustomerIdForApi } from "../../../../lib/stripe-customer";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function ensureCartTables(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      product_type TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      FOREIGN KEY (cart_id) REFERENCES cart(id)
    );
  `);
  try {
    db.exec("ALTER TABLE cart ADD COLUMN promo_code TEXT");
  } catch {
    /* already exists */
  }
}

function parsePriceToCents(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    /** Staff-only: false = one-time monthly period (no auto-renew). Omitted or true = recurring. */
    const monthly_recurring_body = body.monthly_recurring as boolean | undefined;
    if (!member_id) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }
    const sessionMemberId = await getMemberIdFromSession();
    const isStaff = !!(await getTrainerMemberId(request));
    const isStaffCheckoutForOtherMember = !!(isStaff && sessionMemberId && sessionMemberId !== member_id);
    if (sessionMemberId !== member_id && !isStaff) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) {
      return NextResponse.json(
        { error: "Stripe is not configured (STRIPE_SECRET_KEY missing)" },
        { status: 500 }
      );
    }

    const db = getDb();
    ensureCartTables(db);
    ensureMembersStripeColumn(db);
    ensureRecurringClassesTables(db);
    ensureClassesRecurringColumns(db);
    ensureClassOccurrencesClassId(db);

    const memberRow = db.prepare("SELECT email, stripe_customer_id FROM members WHERE member_id = ?").get(member_id) as { email: string | null; stripe_customer_id: string | null } | undefined;
    const customerEmail = memberRow?.email?.trim() || undefined;
    const existingStripeCustomerId = stripeCustomerIdForApi(memberRow?.stripe_customer_id);

    const cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number; promo_code?: string | null } | undefined;
    if (!cart) {
      db.close();
      return NextResponse.json({ error: "No cart for this member" }, { status: 404 });
    }

    const rawItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as {
      id: number;
      product_type: string;
      product_id: number;
      quantity: number;
    }[];

    let hasMonthlyMembershipInCart = false;
    // ACH allowed when: (a) cart has ONLY monthly membership plans, OR (b) member has active monthly membership (Option A)
    let achAllowed = rawItems.length > 0;
    let cartOnlyMonthly = rawItems.length > 0;
    for (const it of rawItems) {
      if (it.product_type !== "membership_plan") {
        cartOnlyMonthly = false;
        continue;
      }
      const plan = db.prepare("SELECT unit FROM membership_plans WHERE id = ?").get(it.product_id) as { unit: string } | undefined;
      if (plan?.unit === "Month") hasMonthlyMembershipInCart = true;
      else cartOnlyMonthly = false;
    }
    for (const it of rawItems) {
      if (it.product_type !== "membership_plan") {
        cartOnlyMonthly = false;
        break;
      }
    }
    if (cartOnlyMonthly) {
      achAllowed = true;
    } else {
      // Option A: active monthly member can use ACH for any cart (classes, PT, etc.)
      const hasActiveMonthly = db.prepare(`
        SELECT 1 FROM subscriptions s
        JOIN membership_plans p ON p.product_id = s.product_id
        WHERE s.member_id = ? AND s.status = 'Active' AND p.unit = 'Month'
        LIMIT 1
      `).get(member_id);
      achAllowed = !!hasActiveMonthly;
    }

    const lineItems: { name: string; price: string; quantity: number }[] = [];
    for (const it of rawItems) {
      let name = "Item";
      let price = "0";
      if (it.product_type === "membership_plan") {
        const row = db.prepare("SELECT plan_name, price FROM membership_plans WHERE id = ?").get(it.product_id) as { plan_name: string; price: string } | undefined;
        if (row) {
          name = row.plan_name ?? "Membership";
          price = row.price ?? "0";
        }
      } else if (it.product_type === "pt_session") {
        const row = db.prepare("SELECT session_name, price FROM pt_sessions WHERE id = ?").get(it.product_id) as { session_name: string; price: string } | undefined;
        if (row) {
          name = row.session_name ?? "PT Session";
          price = row.price ?? "0";
        }
      } else if (it.product_type === "class") {
        const row = db.prepare("SELECT class_name, price FROM classes WHERE id = ?").get(it.product_id) as { class_name: string; price: string } | undefined;
        if (row) {
          name = row.class_name ?? "Class";
          price = row.price ?? "0";
        }
      } else if (it.product_type === "class_pack") {
        const row = db.prepare("SELECT name, price FROM class_pack_products WHERE id = ?").get(it.product_id) as { name: string; price: string } | undefined;
        if (row) {
          name = row.name ?? "Class pack";
          price = row.price ?? "0";
        }
      } else if (it.product_type === "class_occurrence") {
        const occ = db.prepare(`
          SELECT o.id, o.occurrence_date, o.occurrence_time,
                 COALESCE(c.class_name, r.name) AS class_name, COALESCE(c.price, '0') AS price
          FROM class_occurrences o
          LEFT JOIN classes c ON c.id = o.class_id
          LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
          WHERE o.id = ?
        `).get(it.product_id) as { class_name: string; price: string; occurrence_date: string; occurrence_time: string } | undefined;
        if (occ) {
          name = `${occ.class_name ?? "Class"} — ${occ.occurrence_date} ${occ.occurrence_time}`;
          price = occ.price ?? "0";
        }
      } else if (it.product_type === "pt_pack") {
        ensurePTSlotTables(db);
        const row = db.prepare("SELECT name, price FROM pt_pack_products WHERE id = ?").get(it.product_id) as { name: string; price: string } | undefined;
        if (row) {
          name = row.name ?? "PT pack";
          price = row.price ?? "0";
        }
      }
      lineItems.push({ name, price, quantity: Math.max(1, it.quantity) });
    }

    let percentOff = 0;
    const promoCode = cart?.promo_code?.trim();
    if (promoCode) {
      ensureDiscountsTable(db);
      const discount = db.prepare("SELECT percent_off FROM discounts WHERE UPPER(TRIM(code)) = ?").get(promoCode.toUpperCase()) as { percent_off: number } | undefined;
      if (discount) percentOff = Math.min(100, Math.max(0, discount.percent_off));
    }
    db.close();

    if (percentOff > 0) {
      const multiplier = 1 - percentOff / 100;
      lineItems.forEach((item) => {
        const orig = parseFloat(String(item.price).replace(/[^0-9.-]/g, "")) || 0;
        if (orig > 0) {
          item.price = String((orig * multiplier).toFixed(2));
        }
      });
    }

    if (lineItems.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // Add CC fee line item (3% + $0.30)
    const subtotalAfterDiscount = lineItems.reduce((sum, it) => {
      const p = parseFloat(String(it.price).replace(/[^0-9.-]/g, "")) || 0;
      return sum + p * (it.quantity || 1);
    }, 0);
    const ccFeeDollars = computeCcFee(subtotalAfterDiscount);
    if (ccFeeDollars > 0) {
      lineItems.push({
        name: "Credit card processing fee",
        price: ccFeeDollars.toFixed(2),
        quantity: 1,
      });
    }

    const stripe = new Stripe(stripeSecret);

    // Use canonical app URL when set (avoids wrong origin from in-app browsers, PWAs, proxies)
    const proto = request.headers.get("x-forwarded-proto");
    const host = request.headers.get("x-forwarded-host");
    const origin =
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      (proto && host ? `${proto}://${host}`.replace(/\/$/, "") : null) ||
      request.headers.get("origin") ||
      request.nextUrl.origin;
    const base = origin.replace(/\/$/, "");
    const successUrl = `${base}/members/${member_id}/cart/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/members/${member_id}/cart`;

    const taxRateId = process.env.STRIPE_TAX_RATE_ID?.trim() || null;

    /** Only monthly membership subscriptions use auto_renew; classes/PT in the same cart are one-time. */
    let monthlyRecurringMeta: string | undefined;
    if (hasMonthlyMembershipInCart) {
      if (isStaffCheckoutForOtherMember) {
        monthlyRecurringMeta = monthly_recurring_body === false ? "0" : "1";
      } else {
        monthlyRecurringMeta = "1";
      }
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: achAllowed ? ["card", "us_bank_account"] : ["card"],
      mode: "payment",
      billing_address_collection: "required",
      line_items: lineItems.map((item) => {
        const unitAmount = parsePriceToCents(item.price);
        if (unitAmount <= 0) {
          throw new Error(`Invalid price for ${item.name}`);
        }
        const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
          price_data: {
            currency: "usd",
            product_data: { name: item.name },
            unit_amount: unitAmount,
            tax_behavior: "exclusive",
          },
          quantity: item.quantity,
        };
        if (taxRateId) {
          lineItem.tax_rates = [taxRateId];
        }
        return lineItem;
      }),
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        member_id,
        stripe_checkout_flow: "v2",
        save_card_for_future: "1",
        ...(monthlyRecurringMeta != null ? { monthly_recurring: monthlyRecurringMeta } : {}),
        ...(promoCode ? { promo_code: promoCode } : {}),
      },
    };

    sessionParams.payment_intent_data = {
      metadata: {
        member_id,
        ...(monthlyRecurringMeta != null ? { monthly_recurring: monthlyRecurringMeta } : {}),
      },
      setup_future_usage: "off_session",
    };
    // Always attach existing Stripe Customer when we have one so Checkout can show saved cards.
    if (existingStripeCustomerId) {
      sessionParams.customer = existingStripeCustomerId;
    } else if (customerEmail) {
      sessionParams.customer_email = customerEmail;
      sessionParams.customer_creation = "always";
    } else {
      return NextResponse.json(
        { error: "Member needs an email address for Stripe checkout. Add one on the member profile." },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
