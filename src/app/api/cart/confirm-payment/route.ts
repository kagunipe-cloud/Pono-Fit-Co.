import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersStripeColumn } from "../../../../lib/db";
import { sendPostPurchaseEmail, sendAppDownloadInviteEmail } from "../../../../lib/email";
import { grantAccess as kisiGrantAccess, ensureKisiUser } from "../../../../lib/kisi";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { formatInAppTz, formatDateTimeInAppTz } from "../../../../lib/app-timezone";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getAdminMemberId } from "../../../../lib/admin";
import { randomUUID } from "crypto";
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let member_id = (body.member_id ?? "").trim();
    const stripe_session_id = (body.stripe_session_id ?? "").trim() || null;

    if (stripe_session_id) {
      const stripeSecret = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecret) {
        return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
      }
      const stripe = new Stripe(stripeSecret);
      const session = await stripe.checkout.sessions.retrieve(stripe_session_id);
      if (session.payment_status !== "paid") {
        return NextResponse.json(
          { error: "Payment not completed. Only paid Stripe sessions can be fulfilled." },
          { status: 400 }
        );
      }
      const metaMemberId = session.metadata?.member_id;
      if (metaMemberId) member_id = metaMemberId;
      // If they opted in to save card, store Stripe customer id on member for renewals
      const saveCard = session.metadata?.save_card_for_future === "1";
      const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (saveCard && stripeCustomerId) {
        const dbForCustomer = getDb();
        ensureMembersStripeColumn(dbForCustomer);
        dbForCustomer.prepare("UPDATE members SET stripe_customer_id = ? WHERE member_id = ?").run(stripeCustomerId, member_id);
        dbForCustomer.close();
      }
    }

    if (!member_id) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }
    const sessionMemberId = await getMemberIdFromSession();
    const isAdmin = !!(await getAdminMemberId(request));
    if (sessionMemberId !== member_id && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const db = getDb();

    const cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number } | undefined;
    if (!cart) {
      db.close();
      return NextResponse.json({ error: "No cart for this member" }, { status: 404 });
    }

    const items = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as { id: number; product_type: string; product_id: number; quantity: number; slot_json?: string | null }[];
    if (items.length === 0) {
      db.close();
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    const sales_id = randomUUID().slice(0, 8);
    const date_time = formatDateTimeInAppTz(new Date());
    let grand_total = 0;
    const memberRow = db.prepare("SELECT kisi_id, email, first_name, last_name FROM members WHERE member_id = ?").get(member_id) as {
      kisi_id: string | null;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    } | undefined;
    const kisiGrants: { valid_until: Date }[] = [];

    db.exec("BEGIN TRANSACTION");
    try {
      for (const it of items) {
        if (it.product_type === "membership_plan") {
          const plan = db.prepare("SELECT * FROM membership_plans WHERE id = ?").get(it.product_id) as { plan_name: string; price: string; length: string; unit: string; product_id: string } | undefined;
          if (plan) {
            const price = parsePrice(plan.price) * it.quantity;
            grand_total += price;
            const start_date = new Date();
            const expiry_date = addDuration(start_date, plan.length || "1", plan.unit || "Month");
            const startStr = formatInAppTz(start_date, { month: "numeric", day: "numeric", year: "numeric" });
            const expiryStr = formatInAppTz(expiry_date, { month: "numeric", day: "numeric", year: "numeric" });
            const daysRemaining = Math.ceil((expiry_date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
            const sub_id = randomUUID().slice(0, 8);
            db.prepare(`
              INSERT INTO subscriptions (subscription_id, member_id, product_id, status, start_date, expiry_date, days_remaining, price, sales_id, quantity)
              VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?)
            `).run(sub_id, member_id, plan.product_id, startStr, expiryStr, String(daysRemaining), plan.price, sales_id, it.quantity);
            db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(expiryStr, member_id);
            kisiGrants.push({ valid_until: expiry_date });
          }
        } else if (it.product_type === "pt_session") {
          ensurePTSlotTables(db);
          const session = db.prepare("SELECT * FROM pt_sessions WHERE id = ?").get(it.product_id) as { id: number; price: string; product_id: string; duration_minutes?: number } | undefined;
          if (session) {
            grand_total += parsePrice(session.price) * it.quantity;
            let slot: { date: string; start_time: string; duration_minutes: number } | null = null;
            if (it.slot_json) {
              try {
                const parsed = JSON.parse(it.slot_json);
                if (parsed?.date && parsed?.start_time != null && typeof parsed.duration_minutes === "number") {
                  slot = { date: String(parsed.date), start_time: String(parsed.start_time), duration_minutes: Number(parsed.duration_minutes) };
                }
              } catch {
                /* ignore */
              }
            }
            if (slot) {
              db.prepare(
                "INSERT INTO pt_open_bookings (member_id, occurrence_date, start_time, duration_minutes, pt_session_id, payment_type) VALUES (?, ?, ?, ?, ?, 'paid')"
              ).run(member_id, slot.date, slot.start_time, slot.duration_minutes, session.id);
            } else {
              const pt_booking_id = randomUUID().slice(0, 8);
              try {
                db.prepare(`
                  INSERT INTO pt_bookings (pt_booking_id, product_id, member_id, payment_status, booking_date, sales_id, price, quantity)
                  VALUES (?, ?, ?, 'Paid', ?, ?, ?, ?)
                `).run(pt_booking_id, session.product_id, member_id, date_time, sales_id, session.price, it.quantity);
              } catch {
                /* pt_bookings table may not exist in all envs */
              }
              try {
                db.prepare("INSERT INTO pt_slot_bookings (pt_session_id, member_id, payment_type) VALUES (?, ?, 'paid')").run(session.id, member_id);
              } catch {
                /* already booked */
              }
            }
          }
        } else if (it.product_type === "class") {
          const cls = db.prepare("SELECT * FROM classes WHERE id = ?").get(it.product_id) as { price: string; product_id: string } | undefined;
          if (cls) {
            grand_total += parsePrice(cls.price) * it.quantity;
            const class_booking_id = randomUUID().slice(0, 8);
            db.prepare(`
              INSERT INTO class_bookings (class_booking_id, product_id, member_id, payment_status, booking_date, sales_id, price, quantity)
              VALUES (?, ?, ?, 'Paid', ?, ?, ?, ?)
            `).run(class_booking_id, cls.product_id, member_id, date_time, sales_id, cls.price, it.quantity);
          }
        } else if (it.product_type === "class_pack") {
          ensureRecurringClassesTables(db);
          const pack = db.prepare("SELECT * FROM class_pack_products WHERE id = ?").get(it.product_id) as { credits: number; price: string } | undefined;
          if (pack) {
            const totalCredits = pack.credits * it.quantity;
            grand_total += parsePrice(pack.price) * it.quantity;
            db.prepare(`
              INSERT INTO class_credit_ledger (member_id, amount, reason, reference_type, reference_id)
              VALUES (?, ?, 'purchase', 'sale', ?)
            `).run(member_id, totalCredits, sales_id);
          }
        } else if (it.product_type === "class_occurrence") {
          ensureRecurringClassesTables(db);
          const occ = db.prepare(`
            SELECT o.id, COALESCE(c.price, r.price, '0') AS price
            FROM class_occurrences o
            LEFT JOIN classes c ON c.id = o.class_id
            LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
            WHERE o.id = ?
          `).get(it.product_id) as { id: number; price: string } | undefined;
          if (occ) {
            grand_total += parsePrice(occ.price) * it.quantity;
            try {
              db.prepare("INSERT INTO occurrence_bookings (member_id, class_occurrence_id) VALUES (?, ?)").run(member_id, occ.id);
            } catch {
              /* already booked */
            }
          }
        } else if (it.product_type === "pt_pack") {
          ensurePTSlotTables(db);
          const pack = db.prepare("SELECT id, duration_minutes, credits, price FROM pt_pack_products WHERE id = ?").get(it.product_id) as { duration_minutes: number; credits: number; price: string } | undefined;
          if (pack) {
            const totalCredits = pack.credits * it.quantity;
            grand_total += parsePrice(pack.price) * it.quantity;
            db.prepare(`
              INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id)
              VALUES (?, ?, ?, 'purchase', 'sale', ?)
            `).run(member_id, pack.duration_minutes, totalCredits, sales_id);
          }
        }
      }

      const member = db.prepare("SELECT email FROM members WHERE member_id = ?").get(member_id) as { email: string } | undefined;
      db.prepare(`
        INSERT INTO sales (sales_id, date_time, member_id, grand_total, email, status)
        VALUES (?, ?, ?, ?, ?, 'Paid')
      `).run(sales_id, date_time, member_id, String(grand_total), member?.email ?? "");

      db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(cart.id);

      db.exec("COMMIT");
      db.close();

      const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
      const emailTo = memberRow?.email?.trim();
      if (emailTo) {
        sendPostPurchaseEmail({
          to: emailTo,
          member_id,
          first_name: memberRow?.first_name,
          origin,
        }).then((r) => {
          if (!r.ok) console.error("[Email] post-purchase:", r.error);
        });
      }

      let kisiId = memberRow?.kisi_id?.trim() || null;
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

      if (emailTo) {
        sendAppDownloadInviteEmail({
          to: emailTo,
          first_name: memberRow?.first_name,
          origin,
          member_id,
        }).then((r) => {
          if (!r.ok) console.error("[Email] app download invite:", r.error);
        });
      }

      return NextResponse.json({
        success: true,
        sale_id: sales_id,
        grand_total,
        message: "Payment confirmed. Membership/bookings created. Kisi notified for door access (if configured).",
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
