import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getAppTimezone,
  expiryDateSortableSql,
  ensureMembersAutoRenewColumn,
  ensureMembersDoorAccessWaiverExemptColumn,
  ensureMembersProfileColumns,
  ensureMembersInsuranceProgramColumn,
  ensureMembersInsuranceFitnessIdColumn,
  ensureSubscriptionPassPackColumns,
  ensureSubscriptionPauseStartedColumn,
} from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";
import { normalizeInsuranceProgram } from "../../../../lib/insurance-program";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "../../../../lib/recurring-classes";
import { todayInAppTz, calendarDaysUntilExpiryYmd } from "../../../../lib/app-timezone";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";
import { syncMemberProfileToKisi } from "../../../../lib/kisi";
import { parseBirthday } from "../../../../lib/member-birthday";
import { memberHasDoorAccessToday } from "../../../../lib/pass-access";
import {
  ensureDayPassCreditLedger,
  ensureMembersPassActivationDayColumn,
  getMemberDayPassLedgerBalance,
  migrateLegacyPassPackSubscriptionsToLedger,
} from "../../../../lib/day-pass-credits";
import { getSalePurchaseLinesBySalesId } from "../../../../lib/sale-purchase-lines";

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
    ensureMembersDoorAccessWaiverExemptColumn(db);
    ensureMembersProfileColumns(db);
    ensureMembersInsuranceProgramColumn(db);
    ensureMembersInsuranceFitnessIdColumn(db);
    ensureDayPassCreditLedger(db);
    ensureMembersPassActivationDayColumn(db);
    migrateLegacyPassPackSubscriptionsToLedger(db);

    // If id contains non-digits (e.g. "103eec15"), treat ONLY as member_id. Otherwise parseInt("103eec15")→103
    // would incorrectly match member id=103 (Colin) instead of member_id="103eec15" (DC ACRES).
    const isPurelyNumeric = /^\d+$/.test(id);
    const memberStmt = db.prepare(`
      SELECT m.id, m.member_id, m.first_name, m.last_name, m.preferred_name, m.email, m.phone, m.kisi_id, m.kisi_group_id, m.join_date,
        COALESCE(m.exp_next_payment_date, (SELECT s.expiry_date FROM subscriptions s WHERE s.member_id = m.member_id AND s.status = 'Active' ORDER BY ${expiryDateSortableSql("s.expiry_date")} DESC LIMIT 1)) AS exp_next_payment_date,
        m.role, m.created_at, m.waiver_signed_at, m.door_access_waiver_exempt, m.stripe_customer_id, m.auto_renew,
        m.emergency_contact_name, m.emergency_contact_phone, m.emergency_info, m.spirit_animal,
        m.pronouns, m.birthday, m.mailing_address, m.pass_activation_day, m.insurance_program, m.insurance_fitness_id
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
    ensureSubscriptionPauseStartedColumn(db);
    ensureRecurringClassesTables(db);
    let class_credits = 0;
    try {
      class_credits = getMemberCreditBalance(db, mid);
    } catch {
      /* ignore */
    }
    const tz = getAppTimezone(db);
    const today_ymd = todayInAppTz(tz);

    const rawSubs = db.prepare(`
      SELECT s.*, p.plan_name, p.price as plan_price, p.unit as plan_unit, p.category as plan_category
      FROM subscriptions s
      LEFT JOIN membership_plans p ON p.product_id = s.product_id
      WHERE s.member_id = ?
      ORDER BY s.start_date DESC
    `).all(mid) as Record<string, unknown>[];
    const subscriptions = rawSubs.filter((s) => {
      const cat = String(s.plan_category ?? "").trim();
      const unit = String(s.plan_unit ?? "").trim();
      return !(cat === "Passes" && unit === "Day");
    });
    const day_pass_credits = getMemberDayPassLedgerBalance(db, mid);

    for (const sub of subscriptions) {
      const passCredits = sub.pass_credits_remaining;
      if (passCredits != null && String(passCredits).trim() !== "") {
        sub.days_remaining = String(Math.max(0, Math.floor(Number(passCredits))));
        continue;
      }
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

    const saleIdsForLines = sales.map((row) => String(row.sales_id ?? "").trim()).filter(Boolean);
    const linesBySale = getSalePurchaseLinesBySalesId(db, mid, saleIdsForLines);
    const salesWithLines = sales.map((row) => {
      const sid = String(row.sales_id ?? "").trim();
      const purchase_lines = [...(linesBySale.get(sid) ?? [])];
      const saleType = String(row.sale_type ?? "").trim().toLowerCase();
      if (purchase_lines.length === 0 && saleType === "renewal") {
        purchase_lines.push({ label: "Membership renewal" });
      }
      return { ...row, purchase_lines };
    });

    const memberPassDay = String(member.pass_activation_day ?? "").trim();
    const has_door_access = memberHasDoorAccessToday(subscriptions, today_ymd, memberPassDay);

    db.close();

    return NextResponse.json({
      member,
      subscriptions,
      day_pass_credits,
      class_credits,
      today_ymd,
      has_door_access,
      classBookings,
      ptBookings,
      ptSlotBookings,
      ptTrainerSpecificBookings,
      ptOpenBookings,
      sales: salesWithLines,
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
    ensureMembersInsuranceProgramColumn(db);
    ensureMembersInsuranceFitnessIdColumn(db);
    ensureMembersDoorAccessWaiverExemptColumn(db);
    const isPurelyNumeric = /^\d+$/.test(id);
    const existing = (isPurelyNumeric
      ? db
          .prepare(
            "SELECT id, email, first_name, last_name, kisi_id FROM members WHERE id = ? OR member_id = ?"
          )
          .get(parseInt(id, 10), id)
      : db
          .prepare("SELECT id, email, first_name, last_name, kisi_id FROM members WHERE member_id = ?")
          .get(id)) as
      | { id: number; email: string | null; first_name: string | null; last_name: string | null; kisi_id: string | null }
      | undefined;
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const memberId = existing.id;

    const body = await request.json() as Record<string, unknown>;

    let doorAccessWaiverExempt: number | undefined;
    if (body.door_access_waiver_exempt !== undefined) {
      const adminMemberId = await getAdminMemberId(request);
      if (!adminMemberId) {
        db.close();
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
      }
      const raw = body.door_access_waiver_exempt;
      const n =
        raw === true || raw === 1 || raw === "1"
          ? 1
          : raw === false || raw === 0 || raw === "0"
            ? 0
            : Number.NaN;
      if (n !== 0 && n !== 1) {
        db.close();
        return NextResponse.json({ error: "door_access_waiver_exempt must be 0 or 1" }, { status: 400 });
      }
      doorAccessWaiverExempt = n;
    }

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
      "insurance_program",
      "insurance_fitness_id",
    ] as const;
    for (const field of fields) {
      if (body[field] !== undefined) {
        const val =
          field === "birthday"
            ? (body.birthday as string | null)
            : field === "insurance_program"
              ? normalizeInsuranceProgram(body.insurance_program)
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
    if (doorAccessWaiverExempt !== undefined) {
      updates.push("door_access_waiver_exempt = ?");
      values.push(doorAccessWaiverExempt);
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
              waiver_signed_at, door_access_waiver_exempt, stripe_customer_id, auto_renew,
              emergency_contact_name, emergency_contact_phone, emergency_info, spirit_animal,
              pronouns, birthday, mailing_address, insurance_program, insurance_fitness_id
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

    // Sync email/name to Kisi when profile fields change (fixes Kisi typos like gmail.con vs .com)
    const profileTouched =
      body.email !== undefined || body.first_name !== undefined || body.last_name !== undefined;
    const email = row?.email?.trim();
    const name = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim() || undefined;
    const prevEmail = (existing.email ?? "").trim().toLowerCase();
    const emailChanged = body.email !== undefined && email != null && email.toLowerCase() !== prevEmail;
    if (profileTouched && email && row) {
      try {
        const sync = await syncMemberProfileToKisi({
          email,
          name,
          kisiId: row.kisi_id,
        });
        if (sync.kisi_id !== (row.kisi_id ?? "").trim()) {
          db.prepare("UPDATE members SET kisi_id = ? WHERE id = ?").run(sync.kisi_id, memberId);
          (row as { kisi_id: string }).kisi_id = sync.kisi_id;
        }
        if (emailChanged) {
          (row as { kisi_synced?: boolean }).kisi_synced = true;
        }
      } catch (e) {
        console.error("[members PATCH] Kisi sync failed:", e);
        const detail = e instanceof Error ? e.message : "Kisi sync failed";
        db.close();
        return NextResponse.json({
          ...row,
          kisi_sync_warning: `Member saved in the app, but Kisi was not updated: ${detail}`,
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
