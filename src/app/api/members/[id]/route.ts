import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getAppTimezone,
  expiryDateSortableSql,
  ensureMembersAutoRenewColumn,
  ensureMembersProfileColumns,
  ensureSubscriptionPassPackColumns,
} from "../../../../lib/db";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "../../../../lib/recurring-classes";
import { todayInAppTz, calendarDaysUntilExpiryYmd } from "../../../../lib/app-timezone";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { updateKisiUser, ensureKisiUser } from "../../../../lib/kisi";
import { parseBirthday } from "../../../../lib/member-birthday";
import { memberHasDoorAccessToday } from "../../../../lib/pass-access";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  if (!id || id.length < 2) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureMembersAutoRenewColumn(db);
    ensureMembersProfileColumns(db);

    // If id contains non-digits (e.g. "103eec15"), treat ONLY as member_id. Otherwise parseInt("103eec15")→103
    // would incorrectly match member id=103 (Colin) instead of member_id="103eec15" (DC ACRES).
    const isPurelyNumeric = /^\d+$/.test(id);
    const memberStmt = db.prepare(`
      SELECT m.id, m.member_id, m.first_name, m.last_name, m.preferred_name, m.email, m.phone, m.kisi_id, m.kisi_group_id, m.join_date,
        COALESCE(m.exp_next_payment_date, (SELECT s.expiry_date FROM subscriptions s WHERE s.member_id = m.member_id AND s.status = 'Active' ORDER BY ${expiryDateSortableSql("s.expiry_date")} DESC LIMIT 1)) AS exp_next_payment_date,
        m.role, m.created_at, m.waiver_signed_at, m.stripe_customer_id, m.auto_renew,
        m.emergency_contact_name, m.emergency_contact_phone, m.emergency_info, m.spirit_animal,
        m.pronouns, m.birthday, m.mailing_address
      FROM members m WHERE ${isPurelyNumeric ? "m.id = ? OR m.member_id = ?" : "m.member_id = ?"}
    `);
    const member = (isPurelyNumeric
      ? memberStmt.get(parseInt(id, 10), id)
      : memberStmt.get(id)) as Record<string, unknown> | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const mid = member.member_id as string;

    ensureSubscriptionPassPackColumns(db);
    ensureRecurringClassesTables(db);
    let class_credits = 0;
    try {
      class_credits = getMemberCreditBalance(db, mid);
    } catch {
      /* ignore */
    }
    const tz = getAppTimezone(db);
    const today_ymd = todayInAppTz(tz);

    const subscriptions = db.prepare(`
      SELECT s.*, p.plan_name, p.price as plan_price, p.unit as plan_unit, p.category as plan_category
      FROM subscriptions s
      LEFT JOIN membership_plans p ON p.product_id = s.product_id
      WHERE s.member_id = ?
      ORDER BY s.start_date DESC
    `).all(mid) as Record<string, unknown>[];

    for (const sub of subscriptions) {
      const exp = sub.expiry_date;
      if (typeof exp === "string" && exp.trim() !== "") {
        const n = calendarDaysUntilExpiryYmd(exp, today_ymd);
        if (n !== null) sub.days_remaining = String(n);
      }
    }

    const classBookings = db.prepare(`
      SELECT b.*, c.class_name, c.date as class_date, c.time as class_time
      FROM class_bookings b
      LEFT JOIN classes c ON c.product_id = b.product_id
      WHERE b.member_id = ?
      ORDER BY b.booking_date DESC
    `).all(mid) as Record<string, unknown>[];

    let ptBookings: Record<string, unknown>[] = [];
    try {
      ptBookings = db.prepare(`
        SELECT b.*, p.session_name, p.date_time as session_date
        FROM pt_bookings b
        LEFT JOIN pt_sessions p ON p.product_id = b.product_id
        WHERE b.member_id = ?
        ORDER BY b.booking_date DESC
      `).all(mid) as Record<string, unknown>[];
    } catch {
      /* pt_bookings table may not exist */
    }

    ensurePTSlotTables(db);
    const ptSlotBookings = db.prepare(`
      SELECT b.id, b.member_id, p.session_name, p.date_time as session_date
      FROM pt_slot_bookings b
      LEFT JOIN pt_sessions p ON p.id = b.pt_session_id
      WHERE b.member_id = ?
      ORDER BY p.date_time DESC
    `).all(mid) as Record<string, unknown>[];
    const ptTrainerSpecificBookings = db.prepare(`
      SELECT b.id, b.occurrence_date, b.start_time, b.session_duration_minutes, b.payment_type, a.trainer
      FROM pt_trainer_specific_bookings b
      JOIN trainer_availability a ON a.id = b.trainer_availability_id
      WHERE b.member_id = ?
      ORDER BY b.occurrence_date DESC, b.start_time DESC
    `).all(mid) as Record<string, unknown>[];

    const ptOpenBookings = db.prepare(`
      SELECT ob.id, ob.occurrence_date, ob.start_time, ob.duration_minutes, ob.payment_type, p.session_name
      FROM pt_open_bookings ob
      JOIN pt_sessions p ON p.id = ob.pt_session_id
      WHERE ob.member_id = ?
      ORDER BY ob.occurrence_date DESC, ob.start_time DESC
    `).all(mid) as Record<string, unknown>[];

    const sales = db.prepare(`
      SELECT * FROM sales WHERE member_id = ? ORDER BY date_time DESC
    `).all(mid) as Record<string, unknown>[];

    const has_door_access = memberHasDoorAccessToday(subscriptions, today_ymd);

    db.close();

    return NextResponse.json({
      member,
      subscriptions,
      class_credits,
      today_ymd,
      has_door_access,
      classBookings,
      ptBookings,
      ptSlotBookings,
      ptTrainerSpecificBookings,
      ptOpenBookings,
      sales,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch member" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  if (!id || id.length < 2) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureMembersProfileColumns(db);
    const isPurelyNumeric = /^\d+$/.test(id);
    const existing = (isPurelyNumeric
      ? db.prepare("SELECT id FROM members WHERE id = ? OR member_id = ?").get(parseInt(id, 10), id)
      : db.prepare("SELECT id FROM members WHERE member_id = ?").get(id)) as { id: number } | undefined;
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const memberId = existing.id;

    const body = await request.json() as Record<string, unknown>;
    if (body.birthday !== undefined) {
      const r = parseBirthday(String(body.birthday ?? ""));
      if (!r.ok) {
        db.close();
        return NextResponse.json({ error: r.message }, { status: 400 });
      }
      body.birthday = r.value;
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    const fields = [
      "first_name",
      "last_name",
      "email",
      "phone",
      "kisi_id",
      "kisi_group_id",
      "join_date",
      "exp_next_payment_date",
      "role",
      "preferred_name",
      "emergency_contact_name",
      "emergency_contact_phone",
      "emergency_info",
      "spirit_animal",
      "pronouns",
      "birthday",
      "mailing_address",
    ] as const;
    for (const field of fields) {
      if (body[field] !== undefined) {
        const val =
          field === "birthday"
            ? (body.birthday as string | null)
            : typeof body[field] === "string"
              ? (body[field] as string).trim() || null
              : body[field];
        if (field === "email" && (val == null || val === "")) {
          db.close();
          return NextResponse.json(
            { error: "Email is required. It is used for login and Kisi door access." },
            { status: 400 }
          );
        }
        updates.push(`${field} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) {
      db.close();
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    values.push(memberId);

    const stmt = db.prepare(`
      UPDATE members SET ${updates.join(", ")} WHERE id = ?
    `);
    stmt.run(...values);
    const row = db.prepare(
      `SELECT id, member_id, first_name, last_name, preferred_name, email, phone, kisi_id, kisi_group_id, join_date, exp_next_payment_date, role, created_at,
              waiver_signed_at, stripe_customer_id, auto_renew,
              emergency_contact_name, emergency_contact_phone, emergency_info, spirit_animal,
              pronouns, birthday, mailing_address
       FROM members WHERE id = ?`
    ).get(memberId) as {
      id: number;
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      kisi_id: string | null;
    } | undefined;

    // Sync email/name to Kisi regardless of current door access (handles cancel-and-return members)
    const profileChanged = body.email !== undefined || body.first_name !== undefined || body.last_name !== undefined;
    const email = row?.email?.trim();
    const name = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim() || undefined;
    if (profileChanged && email && row) {
      try {
        const kisiId = row.kisi_id?.trim();
        if (kisiId) {
          await updateKisiUser(kisiId, { email, name });
        } else {
          const newKisiId = await ensureKisiUser(email, name);
          db.prepare("UPDATE members SET kisi_id = ? WHERE id = ?").run(newKisiId, memberId);
          (row as { kisi_id: string }).kisi_id = newKisiId;
        }
      } catch (e) {
        console.error("[members PATCH] Kisi sync failed:", e);
        db.close();
        return NextResponse.json({
          ...row,
          kisi_sync_warning: "Member updated but Kisi sync failed. Update the email in Kisi manually if needed.",
        });
      }
    }

    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update member" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  if (!id || id.length < 2) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  try {
    const db = getDb();
    const isPurelyNumeric = /^\d+$/.test(id);
    const existing = (isPurelyNumeric
      ? db.prepare("SELECT id, member_id FROM members WHERE id = ? OR member_id = ?").get(parseInt(id, 10), id)
      : db.prepare("SELECT id, member_id FROM members WHERE member_id = ?").get(id)) as { id: number; member_id: string } | undefined;
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const mid = existing.member_id;

    const hasSubs = (db.prepare("SELECT 1 FROM subscriptions WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    const hasSales = (db.prepare("SELECT 1 FROM sales WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    const hasClass = (db.prepare("SELECT 1 FROM class_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    let hasPt = (db.prepare("SELECT 1 FROM pt_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    try {
      ensurePTSlotTables(db);
      if (!hasPt) hasPt = (db.prepare("SELECT 1 FROM pt_slot_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
      if (!hasPt) hasPt = (db.prepare("SELECT 1 FROM pt_trainer_specific_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
      if (!hasPt) hasPt = (db.prepare("SELECT 1 FROM pt_open_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    } catch {
      /* ignore */
    }
    if (hasSubs || hasSales || hasClass || hasPt) {
      db.close();
      return NextResponse.json(
        { error: "Cannot delete member with subscriptions, bookings, or sales. Remove those first." },
        { status: 409 }
      );
    }

    db.prepare("DELETE FROM members WHERE id = ?").run(existing.id);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to delete member" },
      { status: 500 }
    );
  }
}
