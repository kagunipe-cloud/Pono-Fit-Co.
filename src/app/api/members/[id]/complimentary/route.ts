import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersStripeColumn } from "../../../../../lib/db";
import { ensureRecurringClassesTables } from "../../../../../lib/recurring-classes";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { formatInAppTz, formatDateTimeInAppTz, todayInAppTz } from "../../../../../lib/app-timezone";
import { getAdminMemberId } from "../../../../../lib/admin";
import { grantAccess as kisiGrantAccess, ensureKisiUser } from "../../../../../lib/kisi";
import { sendAppDownloadInviteEmail } from "../../../../../lib/email";
import { ensureWaiverBeforeKisi } from "../../../../../lib/waiver";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

function addDuration(startDate: Date, length: string, unit: string): Date {
  const d = new Date(startDate);
  const n = Math.max(0, parseInt(length, 10) || 1);
  if (unit === "Day") d.setDate(d.getDate() + n);
  else if (unit === "Week") d.setDate(d.getDate() + n * 7);
  else if (unit === "Month") d.setMonth(d.getMonth() + n);
  else if (unit === "Year") d.setFullYear(d.getFullYear() + n);
  return d;
}

/** POST — Admin only. Give member a complimentary (free) product. Body: { product_type, product_id, quantity?, free_months? }.
 * For membership_plan: free_months overrides plan length (optional). Kisi access is granted for the membership duration.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const memberParam = (await params).id;
  const numericId = parseInt(memberParam, 10);
  const isNumeric = !Number.isNaN(numericId);

  const db = getDb();
  const member = (isNumeric
    ? db.prepare("SELECT member_id FROM members WHERE id = ?").get(numericId)
    : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(memberParam)) as { member_id: string } | undefined;
  if (!member) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const member_id = member.member_id;

  let body: { product_type?: string; product_id?: number; quantity?: number; free_months?: number };
  try {
    body = await request.json();
  } catch {
    db.close();
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const product_type = String(body.product_type ?? "").trim();
  const product_id = typeof body.product_id === "number" ? body.product_id : parseInt(String(body.product_id ?? ""), 10);
  const quantity = Math.max(1, typeof body.quantity === "number" ? body.quantity : parseInt(String(body.quantity ?? "1"), 10) || 1);
  const free_months = typeof body.free_months === "number" ? body.free_months : body.free_months != null ? parseInt(String(body.free_months), 10) : null;

  if (!product_type || !product_id || Number.isNaN(product_id)) {
    db.close();
    return NextResponse.json({ error: "product_type and product_id required" }, { status: 400 });
  }

  const sales_id = randomUUID().slice(0, 8);
  const tz = getAppTimezone(db);
  const date_time = formatDateTimeInAppTz(new Date(), undefined, tz);
  const sale_date = todayInAppTz(tz);
  const memberRow = db.prepare("SELECT email, kisi_id, first_name, last_name FROM members WHERE member_id = ?").get(member_id) as {
    email: string | null;
    kisi_id: string | null;
    first_name: string | null;
    last_name: string | null;
  } | undefined;

  let kisiValidUntil: Date | null = null;

  db.exec("BEGIN TRANSACTION");
  try {
    if (product_type === "membership_plan") {
      const plan = db.prepare("SELECT * FROM membership_plans WHERE id = ?").get(product_id) as { plan_name: string; length: string; unit: string; product_id: string } | undefined;
      if (!plan) {
        db.exec("ROLLBACK");
        db.close();
        return NextResponse.json({ error: "Membership plan not found" }, { status: 404 });
      }
      const start_date = new Date();
      const monthsToAdd = free_months != null && free_months >= 0 ? free_months : parseInt(plan.length || "1", 10);
      const expiry_date = addDuration(start_date, String(monthsToAdd), plan.unit === "Month" ? "Month" : plan.unit || "Month");
      kisiValidUntil = expiry_date;
      const startStr = formatInAppTz(start_date, { month: "numeric", day: "numeric", year: "numeric" }, tz);
      const expiryStr = formatInAppTz(expiry_date, { month: "numeric", day: "numeric", year: "numeric" }, tz);
      const daysRemaining = Math.ceil((expiry_date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      const sub_id = randomUUID().slice(0, 8);
      db.prepare(`
        INSERT INTO subscriptions (subscription_id, member_id, product_id, status, start_date, expiry_date, days_remaining, price, sales_id, quantity)
        VALUES (?, ?, ?, 'Active', ?, ?, ?, '0', ?, ?)
      `).run(sub_id, member_id, plan.product_id, startStr, expiryStr, String(daysRemaining), sales_id, quantity);
      db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(expiryStr, member_id);
    } else if (product_type === "pt_session") {
      ensurePTSlotTables(db);
      const session = db.prepare("SELECT * FROM pt_sessions WHERE id = ?").get(product_id) as { product_id: string } | undefined;
      if (!session) {
        db.exec("ROLLBACK");
        db.close();
        return NextResponse.json({ error: "PT session not found" }, { status: 404 });
      }
      const pt_booking_id = randomUUID().slice(0, 8);
      try {
        db.prepare(`
          INSERT INTO pt_bookings (pt_booking_id, product_id, member_id, payment_status, booking_date, sales_id, price, quantity)
          VALUES (?, ?, ?, 'Paid', ?, ?, '0', ?)
        `).run(pt_booking_id, session.product_id, member_id, date_time, sales_id, quantity);
      } catch {
        /* pt_bookings table may not exist */
      }
      try {
        db.prepare("INSERT INTO pt_slot_bookings (pt_session_id, member_id, payment_type) VALUES (?, ?, 'complimentary')").run(product_id, member_id);
      } catch {
        /* ignore duplicate */
      }
    } else if (product_type === "class") {
      const cls = db.prepare("SELECT * FROM classes WHERE id = ?").get(product_id) as { product_id: string } | undefined;
      if (!cls) {
        db.exec("ROLLBACK");
        db.close();
        return NextResponse.json({ error: "Class not found" }, { status: 404 });
      }
      const class_booking_id = randomUUID().slice(0, 8);
      db.prepare(`
        INSERT INTO class_bookings (class_booking_id, product_id, member_id, payment_status, booking_date, sales_id, price, quantity)
        VALUES (?, ?, ?, 'Paid', ?, ?, '0', ?)
      `).run(class_booking_id, cls.product_id, member_id, date_time, sales_id, quantity);
    } else if (product_type === "class_pack") {
      ensureRecurringClassesTables(db);
      const pack = db.prepare("SELECT * FROM class_pack_products WHERE id = ?").get(product_id) as { credits: number } | undefined;
      if (!pack) {
        db.exec("ROLLBACK");
        db.close();
        return NextResponse.json({ error: "Class pack not found" }, { status: 404 });
      }
      const totalCredits = pack.credits * quantity;
      db.prepare(`
        INSERT INTO class_credit_ledger (member_id, amount, reason, reference_type, reference_id)
        VALUES (?, ?, 'complimentary', 'sale', ?)
      `).run(member_id, totalCredits, sales_id);
    } else if (product_type === "pt_pack") {
      ensurePTSlotTables(db);
      const pack = db.prepare("SELECT id, duration_minutes, credits FROM pt_pack_products WHERE id = ?").get(product_id) as { duration_minutes: number; credits: number } | undefined;
      if (!pack) {
        db.exec("ROLLBACK");
        db.close();
        return NextResponse.json({ error: "PT pack not found" }, { status: 404 });
      }
      const totalCredits = pack.credits * quantity;
      db.prepare(`
        INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id)
        VALUES (?, ?, ?, 'complimentary', 'sale', ?)
      `).run(member_id, pack.duration_minutes, totalCredits, sales_id);
    } else {
      db.exec("ROLLBACK");
      db.close();
      return NextResponse.json({ error: "Unsupported product_type. Use membership_plan, pt_session, class, class_pack, or pt_pack." }, { status: 400 });
    }

    ensureMembersStripeColumn(db);
    db.prepare(`
      INSERT INTO sales (sales_id, date_time, member_id, grand_total, email, status, sale_date)
      VALUES (?, ?, ?, '0', ?, 'Complimentary', ?)
    `).run(sales_id, date_time, member_id, memberRow?.email ?? "", sale_date);

    db.exec("COMMIT");

    const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
    const waiver = await ensureWaiverBeforeKisi(member_id, {
      email: memberRow?.email ?? null,
      first_name: memberRow?.first_name,
    }, origin);
    if (kisiValidUntil && memberRow && waiver.shouldGrantKisi) {
      try {
        let kisiId = memberRow.kisi_id?.trim() || null;
        if (!kisiId && memberRow.email?.trim()) {
          const name = [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || undefined;
          kisiId = await ensureKisiUser(memberRow.email.trim(), name);
          db.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, member_id);
        }
        if (kisiId) {
          await kisiGrantAccess(kisiId, kisiValidUntil);
        }
      } catch (e) {
        console.error("[Kisi] complimentary grant failed for member:", member_id, e);
      }
    }

    const emailTo = memberRow?.email?.trim();
    if (emailTo) {
      sendAppDownloadInviteEmail({
        to: emailTo,
        first_name: memberRow?.first_name,
        origin,
        member_id,
      }).then((r) => {
        if (!r.ok) console.error("[Email] app download invite (complimentary):", r.error);
      });
    }

    db.close();
    return NextResponse.json({
      ok: true,
      sales_id,
      message: "Complimentary product applied. Door access has been updated in Kisi for the membership period.",
    });
  } catch (err) {
    db.exec("ROLLBACK");
    db.close();
    console.error(err);
    return NextResponse.json({ error: "Failed to apply complimentary product" }, { status: 500 });
  }
}
