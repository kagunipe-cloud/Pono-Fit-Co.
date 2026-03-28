import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersStripeColumn, ensureMembersAutoRenewColumn, ensureSalesStripePaymentIntentColumn, ensureSalesPromoCodeColumn, ensureSalesItemTotalCcFeeColumns, ensureSubscriptionRenewalPromoColumns } from "../../../../lib/db";
import { ensureCartTables } from "../../../../lib/cart";
import { getEffectiveUnitPriceString } from "../../../../lib/cart-line-prices";
import { sendPostPurchaseEmail, sendStaffEmail, sendMemberEmail } from "../../../../lib/email";
import { grantAccess as kisiGrantAccess, ensureKisiUser } from "../../../../lib/kisi";
import { ensureWaiverBeforeKisi } from "../../../../lib/waiver";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";
import { ensureDiscountsTable } from "../../../../lib/discounts";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { ensureTrainerClient, getTrainerMemberIdByDisplayName } from "../../../../lib/trainer-clients";
import { formatInAppTz, formatDateTimeInAppTz, todayInAppTz, formatDateForStorage, formatDateForDisplay } from "../../../../lib/app-timezone";
import { formatPrice } from "../../../../lib/format";
import { computeCcFee } from "../../../../lib/cc-fees";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getTrainerMemberId } from "../../../../lib/admin";
import { randomUUID } from "crypto";
import { stripeCustomerIdForApi } from "../../../../lib/stripe-customer";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function parsePrice(p: string | null): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function addDuration(startDate: Date, length: string, unit: string): Date {
  const d = new Date(startDate);
  const n = Math.max(0, parseInt(length, 10) || 1);
  if (unit === "Day") d.setDate(d.getDate() + n);
  else if (unit === "Week") d.setDate(d.getDate() + n * 7);
  else if (unit === "Month") d.setMonth(d.getMonth() + n);
  else if (unit === "Year") d.setFullYear(d.getFullYear() + n);
  return d;
}

/** Resolve Stripe Customer id from a paid Checkout Session (expand customer + payment_intent). */
function stripeCustomerIdFromCheckoutSession(session: Stripe.Checkout.Session): string | null {
  const c = session.customer;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && "deleted" in c && (c as { deleted?: boolean }).deleted) return null;
  if (c && typeof c === "object" && "id" in c) return (c as Stripe.Customer).id;
  const pi = session.payment_intent;
  if (pi && typeof pi === "object") {
    const pic = (pi as Stripe.PaymentIntent).customer;
    if (typeof pic === "string") return pic;
    if (pic && typeof pic === "object" && "id" in pic) return (pic as Stripe.Customer).id;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let member_id = (body.member_id ?? "").trim();
    const stripe_session_id = (body.stripe_session_id ?? "").trim() || null;
    const payment_intent_id = (body.payment_intent_id ?? "").trim() || null;
    let stripeSession: Stripe.Checkout.Session | null = null;
    let paymentIntentAmount: number | null = null;
    let terminalStripeCustomerId: string | null = null;

    if (stripe_session_id) {
      const stripeSecret = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecret) {
        return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
      }
      const stripe = new Stripe(stripeSecret);
      const session = await stripe.checkout.sessions.retrieve(stripe_session_id, {
        expand: ["customer", "payment_intent"],
      });
      if (session.payment_status !== "paid") {
        return NextResponse.json(
          { error: "Payment not completed. Only paid Stripe sessions can be fulfilled." },
          { status: 400 }
        );
      }
      stripeSession = session;
      const metaMemberId = session.metadata?.member_id;
      if (metaMemberId) member_id = metaMemberId;
    } else if (payment_intent_id) {
      const stripeSecret = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecret) {
        return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
      }
      const stripe = new Stripe(stripeSecret);
      const pi = await stripe.paymentIntents.retrieve(payment_intent_id, { expand: ["customer"] });
      if (pi.status !== "succeeded") {
        return NextResponse.json(
          { error: "Payment not completed. Only succeeded Terminal payments can be fulfilled." },
          { status: 400 }
        );
      }
      const metaMemberId = pi.metadata?.member_id;
      if (metaMemberId) member_id = metaMemberId;
      if (typeof pi.customer === "string") terminalStripeCustomerId = pi.customer;
      else if (pi.customer && typeof pi.customer === "object" && "id" in pi.customer) {
        terminalStripeCustomerId = (pi.customer as Stripe.Customer).id;
      }
      paymentIntentAmount = (pi.amount_received ?? pi.amount) / 100;
      // Tax for terminal payments is stored in PI metadata (we add it in terminal charge route)
      if (pi.metadata?.tax_amount != null) {
        stripeSession = {
          total_details: { amount_tax: Math.round(parseFloat(String(pi.metadata.tax_amount)) * 100) },
        } as Stripe.Checkout.Session;
      }
    }

    if (!member_id) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }
    const sessionMemberId = await getMemberIdFromSession();
    const isStaff = !!(await getTrainerMemberId(request));
    if (sessionMemberId !== member_id && !isStaff) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Persist Stripe Customer id; auto_renew follows monthly_recurring when cart included monthly membership.
    // Legacy sessions: only save_card_for_future in metadata (no monthly_recurring) still maps save_card → auto_renew.
    if (stripe_session_id && stripeSession) {
      const cid = stripeCustomerIdFromCheckoutSession(stripeSession);
      const cidApi = stripeCustomerIdForApi(cid);
      const monthlyRenew = stripeSession.metadata?.monthly_recurring;
      const saveCardLegacy = stripeSession.metadata?.save_card_for_future === "1";
      const flowV2 = stripeSession.metadata?.stripe_checkout_flow === "v2";
      if (cidApi && member_id) {
        const dbStripe = getDb();
        ensureMembersStripeColumn(dbStripe);
        ensureMembersAutoRenewColumn(dbStripe);
        let autoRenew: number | null = null;
        if (monthlyRenew === "1") autoRenew = 1;
        else if (monthlyRenew === "0") autoRenew = 0;
        else if (flowV2) autoRenew = null;
        else if (saveCardLegacy) autoRenew = 1;
        if (autoRenew === null) {
          dbStripe.prepare("UPDATE members SET stripe_customer_id = ? WHERE member_id = ?").run(cidApi, member_id);
        } else {
          dbStripe.prepare("UPDATE members SET stripe_customer_id = ?, auto_renew = ? WHERE member_id = ?").run(
            cidApi,
            autoRenew,
            member_id
          );
        }
        dbStripe.close();
      }
    } else if (stripeCustomerIdForApi(terminalStripeCustomerId) && member_id) {
      const termApi = stripeCustomerIdForApi(terminalStripeCustomerId)!;
      const dbStripe = getDb();
      ensureMembersStripeColumn(dbStripe);
      dbStripe.prepare("UPDATE members SET stripe_customer_id = ? WHERE member_id = ?").run(termApi, member_id);
      dbStripe.close();
    }

    const db = getDb();
    ensureCartTables(db);

    const cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number } | undefined;
    if (!cart) {
      db.close();
      return NextResponse.json({ error: "No cart for this member" }, { status: 404 });
    }

    const items = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as {
      id: number;
      product_type: string;
      product_id: number;
      quantity: number;
      slot_json?: string | null;
      unit_price_override?: string | null;
      price_override_months?: number | null;
      price_override_indefinite?: number | null;
    }[];
    if (items.length === 0) {
      db.close();
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    const sales_id = randomUUID().slice(0, 8);
    const tz = getAppTimezone(db);
    const date_time = formatDateTimeInAppTz(new Date(), undefined, tz);
    const sale_date = todayInAppTz(tz);
    let grand_total = 0;
    const memberRow = db.prepare("SELECT kisi_id, email, first_name, last_name FROM members WHERE member_id = ?").get(member_id) as {
      kisi_id: string | null;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    } | undefined;
    const kisiGrants: { valid_until: Date }[] = [];

    const classBookingEvents: {
      member_id: string;
      class_name: string;
      date: string;
      time: string;
      trainer_member_id?: string | null;
    }[] = [];
    const ptBookingEvents: {
      member_id: string;
      trainerName?: string | null;
      session_name: string;
      date: string;
      time: string;
    }[] = [];
    const emailLineItems: { name: string; quantity: number; price: string }[] = [];

    db.exec("BEGIN TRANSACTION");
    try {
      for (const it of items) {
        if (it.product_type === "membership_plan") {
          const plan = db.prepare("SELECT * FROM membership_plans WHERE id = ?").get(it.product_id) as { plan_name: string; price: string; length: string; unit: string; product_id: string } | undefined;
          if (plan) {
            const effUnit = getEffectiveUnitPriceString(db, it);
            const unitNum = parsePrice(effUnit);
            grand_total += unitNum * it.quantity;
            emailLineItems.push({ name: plan.plan_name ?? "Membership", quantity: it.quantity, price: formatPrice(effUnit) });
            const start_date = new Date();
            const expiry_date = addDuration(start_date, plan.length || "1", plan.unit || "Month");
            const startStr = formatDateForStorage(start_date, tz);
            const expiryStr = formatDateForStorage(expiry_date, tz);
            const daysRemaining = Math.ceil((expiry_date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
            const sub_id = randomUUID().slice(0, 8);
            ensureSubscriptionRenewalPromoColumns(db);
            const hasStaffPrice = !!(it.unit_price_override ?? "").trim();
            const isMonth = (plan.unit || "").trim() === "Month";
            let promoRenewals: number | null = null;
            let renewalIndef = 0;
            if (isMonth && hasStaffPrice) {
              if ((it.price_override_indefinite ?? 0) === 1) {
                renewalIndef = 1;
              } else {
                const m = it.price_override_months != null ? it.price_override_months : 1;
                promoRenewals = Math.max(0, m - 1);
              }
            }
            db.prepare(`
              INSERT INTO subscriptions (subscription_id, member_id, product_id, status, start_date, expiry_date, days_remaining, price, sales_id, quantity, promo_renewals_remaining, renewal_price_indefinite)
              VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              sub_id,
              member_id,
              plan.product_id,
              startStr,
              expiryStr,
              String(daysRemaining),
              effUnit,
              sales_id,
              it.quantity,
              promoRenewals,
              renewalIndef
            );
            db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(expiryStr, member_id);
            kisiGrants.push({ valid_until: expiry_date });
          }
        } else if (it.product_type === "pt_session") {
          ensurePTSlotTables(db);
          const session = db.prepare("SELECT * FROM pt_sessions WHERE id = ?").get(it.product_id) as { id: number; price: string; session_name?: string; product_id: string; duration_minutes?: number; trainer?: string | null } | undefined;
          if (session) {
            const effUnit = getEffectiveUnitPriceString(db, it);
            grand_total += parsePrice(effUnit) * it.quantity;
            emailLineItems.push({ name: session.session_name ?? "PT Session", quantity: it.quantity, price: formatPrice(effUnit) });
            let slot: { date: string; start_time: string; duration_minutes: number; trainer_member_id?: string } | null = null;
            if (it.slot_json) {
              try {
                const parsed = JSON.parse(it.slot_json);
                if (parsed?.date && parsed?.start_time != null && typeof parsed.duration_minutes === "number") {
                  slot = {
                    date: String(parsed.date),
                    start_time: String(parsed.start_time),
                    duration_minutes: Number(parsed.duration_minutes),
                    ...(parsed.trainer_member_id && typeof parsed.trainer_member_id === "string" ? { trainer_member_id: String(parsed.trainer_member_id).trim() } : {}),
                  };
                }
              } catch {
                /* ignore */
              }
            }
            if (slot) {
              const trainerMemberId = slot.trainer_member_id || null;
              db.prepare(
                "INSERT INTO pt_open_bookings (member_id, occurrence_date, start_time, duration_minutes, pt_session_id, payment_type, trainer_member_id) VALUES (?, ?, ?, ?, ?, 'paid', ?)"
              ).run(member_id, slot.date, slot.start_time, slot.duration_minutes, session.id, trainerMemberId);
              if (trainerMemberId) {
                ensureTrainerClient(db, trainerMemberId, member_id);
                const memberRow = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(member_id) as { first_name: string | null; last_name: string | null } | undefined;
                const trainerRow = db.prepare("SELECT email FROM members WHERE member_id = ?").get(trainerMemberId) as { email: string | null } | undefined;
                const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || "A client" : "A client";
                const trainerEmail = trainerRow?.email?.trim();
                if (trainerEmail) {
                  const subject = `PT session assigned: ${memberName} — ${slot.date} at ${slot.start_time}`;
                  const text = `You've been assigned a PT session with ${memberName} on ${slot.date} at ${slot.start_time}.`;
                  sendMemberEmail(trainerEmail, subject, text).catch(() => {});
                }
              }
            } else {
              const pt_booking_id = randomUUID().slice(0, 8);
              try {
                db.prepare(`
                  INSERT INTO pt_bookings (pt_booking_id, product_id, member_id, payment_status, booking_date, sales_id, price, quantity)
                  VALUES (?, ?, ?, 'Paid', ?, ?, ?, ?)
                `).run(pt_booking_id, session.product_id, member_id, date_time, sales_id, effUnit, it.quantity);
              } catch {
                /* pt_bookings table may not exist in all envs */
              }
              try {
                db.prepare("INSERT INTO pt_slot_bookings (pt_session_id, member_id, payment_type) VALUES (?, ?, 'paid')").run(session.id, member_id);
              } catch {
                /* already booked */
              }
              const trainerName = (session.trainer ?? "").trim();
              const trainerMemberId = trainerName ? getTrainerMemberIdByDisplayName(db, trainerName) : null;
              if (trainerMemberId) ensureTrainerClient(db, trainerMemberId, member_id);
            }
          }
        } else if (it.product_type === "class") {
          const cls = db.prepare("SELECT * FROM classes WHERE id = ?").get(it.product_id) as { price: string; product_id: string; class_name?: string | null; date?: string | null; time?: string | null; trainer_member_id?: string | null } | undefined;
          if (cls) {
            const effUnit = getEffectiveUnitPriceString(db, it);
            grand_total += parsePrice(effUnit) * it.quantity;
            emailLineItems.push({ name: cls.class_name ?? "Class", quantity: it.quantity, price: formatPrice(effUnit) });
            const class_booking_id = randomUUID().slice(0, 8);
            db.prepare(`
              INSERT INTO class_bookings (class_booking_id, product_id, member_id, payment_status, booking_date, sales_id, price, quantity)
              VALUES (?, ?, ?, 'Paid', ?, ?, ?, ?)
            `).run(class_booking_id, cls.product_id, member_id, date_time, sales_id, effUnit, it.quantity);
            classBookingEvents.push({
              member_id,
              class_name: String((cls as any).class_name ?? "Class"),
              date: String((cls as any).date ?? ""),
              time: String((cls as any).time ?? ""),
              trainer_member_id: (cls as any).trainer_member_id ?? null,
            });
          }
        } else if (it.product_type === "class_pack") {
          ensureRecurringClassesTables(db);
          const pack = db.prepare("SELECT * FROM class_pack_products WHERE id = ?").get(it.product_id) as { name?: string; credits: number; price: string } | undefined;
          if (pack) {
            const effUnit = getEffectiveUnitPriceString(db, it);
            const totalCredits = pack.credits * it.quantity;
            grand_total += parsePrice(effUnit) * it.quantity;
            emailLineItems.push({ name: pack.name ? `${pack.name} (${pack.credits} credits)` : `Class pack (${pack.credits} credits)`, quantity: it.quantity, price: formatPrice(effUnit) });
            db.prepare(`
              INSERT INTO class_credit_ledger (member_id, amount, reason, reference_type, reference_id)
              VALUES (?, ?, 'purchase', 'sale', ?)
            `).run(member_id, totalCredits, sales_id);
          }
        } else if (it.product_type === "class_occurrence") {
          ensureRecurringClassesTables(db);
          const occ = db.prepare(`
            SELECT o.id,
                   o.occurrence_date,
                   o.occurrence_time,
                   COALESCE(c.price, r.price, '0') AS price,
                   COALESCE(c.class_name, r.name) AS class_name,
                   c.trainer_member_id
            FROM class_occurrences o
            LEFT JOIN classes c ON c.id = o.class_id
            LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
            WHERE o.id = ?
          `).get(it.product_id) as { id: number; price: string; occurrence_date: string; occurrence_time: string | null; class_name: string | null; trainer_member_id: string | null } | undefined;
          if (occ) {
            const effUnit = getEffectiveUnitPriceString(db, it);
            grand_total += parsePrice(effUnit) * it.quantity;
            emailLineItems.push({ name: `${occ.class_name ?? "Class"} — ${occ.occurrence_date} ${occ.occurrence_time ?? ""}`, quantity: it.quantity, price: formatPrice(effUnit) });
            try {
              db.prepare("INSERT INTO occurrence_bookings (member_id, class_occurrence_id) VALUES (?, ?)").run(member_id, occ.id);
            } catch {
              /* already booked */
            }
            classBookingEvents.push({
              member_id,
              class_name: occ.class_name || "Class",
              date: occ.occurrence_date,
              time: occ.occurrence_time ?? "",
              trainer_member_id: occ.trainer_member_id,
            });
          }
        } else if (it.product_type === "pt_pack") {
          ensurePTSlotTables(db);
          const pack = db.prepare("SELECT id, name, duration_minutes, credits, price FROM pt_pack_products WHERE id = ?").get(it.product_id) as { name?: string; duration_minutes: number; credits: number; price: string } | undefined;
          if (pack) {
            const effUnit = getEffectiveUnitPriceString(db, it);
            const totalCredits = pack.credits * it.quantity;
            grand_total += parsePrice(effUnit) * it.quantity;
            emailLineItems.push({ name: pack.name ? `${pack.name} (${pack.credits}×${pack.duration_minutes} min)` : `PT pack (${pack.credits}×${pack.duration_minutes} min)`, quantity: it.quantity, price: formatPrice(effUnit) });
            db.prepare(`
              INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id)
              VALUES (?, ?, ?, 'purchase', 'sale', ?)
            `).run(member_id, pack.duration_minutes, totalCredits, sales_id);
          }
        }
      }

    const member = db.prepare("SELECT email FROM members WHERE member_id = ?").get(member_id) as { email: string } | undefined;
    const promoCode = (stripeSession?.metadata?.promo_code as string) || (db.prepare("SELECT promo_code FROM cart WHERE member_id = ?").get(member_id) as { promo_code?: string | null })?.promo_code?.trim() || null;
    let subtotalAfterDiscount = grand_total;
    if (promoCode) {
      ensureDiscountsTable(db);
      const discount = db.prepare("SELECT percent_off FROM discounts WHERE UPPER(TRIM(code)) = ?").get(promoCode.toUpperCase()) as { percent_off: number } | undefined;
      if (discount) {
        const pct = Math.min(100, Math.max(0, discount.percent_off));
        subtotalAfterDiscount = grand_total * (1 - pct / 100);
      }
    }
    const ccFee = computeCcFee(subtotalAfterDiscount);
    if (ccFee > 0) {
      emailLineItems.push({ name: "Credit card processing fee", quantity: 1, price: formatPrice(ccFee) });
    }
    const finalGrandTotal =
      stripeSession?.amount_total != null
        ? stripeSession.amount_total / 100
        : paymentIntentAmount != null
          ? paymentIntentAmount
          : subtotalAfterDiscount + ccFee;
    const taxAmount = stripeSession?.total_details?.amount_tax != null ? stripeSession.total_details.amount_tax / 100 : 0;
    const paymentIntentId =
      stripeSession?.payment_intent
        ? (typeof stripeSession.payment_intent === "string" ? stripeSession.payment_intent : stripeSession.payment_intent?.id)
        : payment_intent_id;
    const itemTotal = stripeSession?.amount_total != null
      ? finalGrandTotal - taxAmount
      : subtotalAfterDiscount;
    const ccFeeStored = stripeSession?.amount_total != null ? 0 : ccFee;
    ensureSalesStripePaymentIntentColumn(db);
    ensureSalesPromoCodeColumn(db);
    ensureSalesItemTotalCcFeeColumns(db);
    db.prepare(`
        INSERT INTO sales (sales_id, date_time, member_id, grand_total, tax_amount, item_total, cc_fee, email, status, sale_date, stripe_payment_intent_id, promo_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Paid', ?, ?, ?)
      `).run(sales_id, date_time, member_id, String(finalGrandTotal), String(taxAmount), String(itemTotal), String(ccFeeStored), member?.email ?? "", sale_date, paymentIntentId, promoCode || null);

      db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(cart.id);

      db.exec("COMMIT");
      db.close();

      const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
      const emailTo = memberRow?.email?.trim();
      const waiver = await ensureWaiverBeforeKisi(member_id, {
        email: memberRow?.email ?? null,
        first_name: memberRow?.first_name,
      }, origin);
      let kisiId = memberRow?.kisi_id?.trim() || null;
      if (waiver.shouldGrantKisi) {
        for (const g of kisiGrants) {
          try {
            if (!kisiId) {
              const email = memberRow?.email?.trim();
              if (email) {
                const name = [memberRow?.first_name, memberRow?.last_name].filter(Boolean).join(" ") || undefined;
                kisiId = await ensureKisiUser(email, name || undefined);
                const db2 = getDb();
                ensureMembersStripeColumn(db2);
                db2.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, member_id);
                db2.close();
              }
            }
            if (kisiId) {
              await kisiGrantAccess(kisiId, g.valid_until);
            }
          } catch (e) {
            console.error("[Kisi] grant failed for member:", member_id, e);
          }
        }
      }

      if (emailTo) {
        sendPostPurchaseEmail({
          to: emailTo,
          member_id,
          first_name: memberRow?.first_name,
          origin,
          receipt: {
            date: formatDateForDisplay(sale_date, tz) || sale_date,
            total: formatPrice(finalGrandTotal),
            items: emailLineItems,
          },
        }).then((r) => {
          if (!r.ok) console.error("[Email] post-purchase:", r.error);
        });
      }

      // Fire-and-forget booking notification emails after commit
      (async () => {
        try {
          const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || member_id : member_id;
          // Class bookings
          for (const ev of classBookingEvents) {
            const whenStr = `${ev.date} ${ev.time}`.trim();
            const className = ev.class_name;
            const staffSubject = `Class booking: ${memberName} → ${className}`;
            const staffBody = `${memberName} booked ${className} on ${whenStr || ev.date}.`;
            await sendStaffEmail(staffSubject, staffBody);
            const trainerId = (ev.trainer_member_id ?? "").trim();
            if (trainerId) {
              const dbt = getDb();
              const trainerRow = dbt
                .prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?")
                .get(trainerId) as { email: string | null } | undefined;
              dbt.close();
              const trainerEmail = trainerRow?.email?.trim();
              if (trainerEmail) {
                const trainerSubject = `New class booking for ${className}`;
                const trainerBody = `${memberName} booked your class "${className}" on ${whenStr || ev.date}.`;
                await sendMemberEmail(trainerEmail, trainerSubject, trainerBody);
              }
            }
          }

          // PT bookings (only open slots created via this confirm)
          for (const ev of ptBookingEvents) {
            const whenStr = `${ev.date} ${ev.time}`.trim();
            const staffSubject = `PT booking: ${memberName} → ${ev.session_name}`;
            const staffBody = `${memberName} booked ${ev.session_name} on ${whenStr || ev.date}.`;
            await sendStaffEmail(staffSubject, staffBody);
            const trainerName = (ev.trainerName ?? "").trim();
            if (trainerName) {
              const dbt = getDb();
              const trainerRow = dbt
                .prepare(
                  `SELECT m.email
                   FROM trainers t
                   JOIN members m ON m.member_id = t.member_id
                   WHERE TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) = ?`
                )
                .get(trainerName) as { email: string | null } | undefined;
              dbt.close();
              const trainerEmail = trainerRow?.email?.trim();
              if (trainerEmail) {
                const trainerSubject = `New PT booking with ${memberName}`;
                const trainerBody = `${memberName} booked ${ev.session_name} with you on ${whenStr || ev.date}.`;
                await sendMemberEmail(trainerEmail, trainerSubject, trainerBody);
              }
            }
          }
        } catch (err) {
          console.error("[Email] booking notifications failed:", err);
        }
      })();

      return NextResponse.json({
        success: true,
        sale_id: sales_id,
        grand_total,
        message: waiver.shouldGrantKisi
          ? "Payment confirmed. Membership/bookings created. Kisi notified for door access (if configured)."
          : "Payment confirmed. Sign the liability waiver in the app to activate door access.",
      });
    } catch (e) {
      db.exec("ROLLBACK");
      db.close();
      throw e;
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to confirm payment" },
      { status: 500 }
    );
  }
}
