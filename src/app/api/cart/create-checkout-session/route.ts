import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "../../../../lib/db";
import { ensureRecurringClassesTables, ensureClassesRecurringColumns, ensureClassOccurrencesClassId } from "../../../../lib/recurring-classes";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getAdminMemberId } from "../../../../lib/admin";
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
    const save_card_for_future = Boolean(body.save_card_for_future);
    if (!member_id) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }
    const sessionMemberId = await getMemberIdFromSession();
    const isAdmin = !!(await getAdminMemberId(request));
    if (sessionMemberId !== member_id && !isAdmin) {
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
    const existingStripeCustomerId = memberRow?.stripe_customer_id?.trim() || undefined;

    const cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number } | undefined;
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
    db.close();

    if (lineItems.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    const stripe = new Stripe(stripeSecret);

    const origin = request.headers.get("origin") ?? request.nextUrl.origin;
    const successUrl = `${origin}/members/${member_id}/cart/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/members/${member_id}/cart`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: "payment",
      line_items: lineItems.map((item) => {
        const unitAmount = parsePriceToCents(item.price);
        if (unitAmount <= 0) {
          throw new Error(`Invalid price for ${item.name}`);
        }
        return {
          price_data: {
            currency: "usd",
            product_data: { name: item.name },
            unit_amount: unitAmount,
          },
          quantity: item.quantity,
        };
      }),
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { member_id, save_card_for_future: save_card_for_future ? "1" : "0" },
    };

    if (save_card_for_future) {
      sessionParams.payment_intent_data = { setup_future_usage: "off_session" };
      if (existingStripeCustomerId) {
        sessionParams.customer = existingStripeCustomerId;
      } else if (customerEmail) {
        sessionParams.customer_email = customerEmail;
      }
    }
    // Always prefill email when we have it (for Kisi and receipts)
    if (!sessionParams.customer && !sessionParams.customer_email && customerEmail) {
      sessionParams.customer_email = customerEmail;
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
