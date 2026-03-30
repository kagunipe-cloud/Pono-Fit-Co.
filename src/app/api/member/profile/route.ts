import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getDb,
  ensureMembersProfileColumns,
  ensureMembersStripeColumn,
  ensureMembersPasswordColumn,
} from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { stripeCustomerIdForApi } from "../../../../lib/stripe-customer";
import { parseBirthday } from "../../../../lib/member-birthday";

export const dynamic = "force-dynamic";

const MAX_LEN = 2000;

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

function isValidEmail(s: string): boolean {
  if (!s || s.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const db = getDb();
    ensureMembersProfileColumns(db);
    ensureMembersPasswordColumn(db);
    const row = db.prepare(
      `SELECT member_id, first_name, last_name, preferred_name, email, phone,
              emergency_contact_name, emergency_contact_phone, emergency_info, spirit_animal,
              pronouns, birthday, mailing_address,
              password_hash
       FROM members WHERE member_id = ?`
    ).get(memberId) as {
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
      email: string | null;
      phone: string | null;
      emergency_contact_name: string | null;
      emergency_contact_phone: string | null;
      emergency_info: string | null;
      spirit_animal: string | null;
      pronouns: string | null;
      birthday: string | null;
      mailing_address: string | null;
      password_hash: string | null;
    } | undefined;

    db.close();

    if (!row) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({
      member_id: row.member_id,
      first_name: row.first_name ?? "",
      last_name: row.last_name ?? "",
      preferred_name: row.preferred_name ?? "",
      email: row.email ?? "",
      phone: row.phone ?? "",
      emergency_contact_name: row.emergency_contact_name ?? "",
      emergency_contact_phone: row.emergency_contact_phone ?? "",
      emergency_info: row.emergency_info ?? "",
      spirit_animal: row.spirit_animal ?? "",
      pronouns: row.pronouns ?? "",
      birthday: row.birthday ?? "",
      mailing_address: row.mailing_address ?? "",
      has_password: !!(row.password_hash ?? "").trim(),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const first_name = String(body.first_name ?? "").trim();
    const last_name = String(body.last_name ?? "").trim();
    const preferred_name = String(body.preferred_name ?? "").trim().slice(0, 120);
    const emailRaw = String(body.email ?? "").trim();
    const phone = String(body.phone ?? "").trim().slice(0, 40);
    const emergency_contact_name = String(body.emergency_contact_name ?? "").trim().slice(0, 120);
    const emergency_contact_phone = String(body.emergency_contact_phone ?? "").trim().slice(0, 40);
    const emergency_info = String(body.emergency_info ?? "").trim().slice(0, MAX_LEN);
    const spirit_animal = String(body.spirit_animal ?? "").trim().slice(0, 120);
    const pronouns = String(body.pronouns ?? "").trim().slice(0, 80);
    const mailing_address = String(body.mailing_address ?? "").trim().slice(0, MAX_LEN);
    const birthdayParsed = parseBirthday(String(body.birthday ?? ""));
    if (!birthdayParsed.ok) {
      return NextResponse.json({ error: birthdayParsed.message }, { status: 400 });
    }
    const birthday = birthdayParsed.value;

    if (!first_name || !last_name) {
      return NextResponse.json({ error: "First and last name are required." }, { status: 400 });
    }
    if (!isValidEmail(emailRaw)) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }

    const email = normalizeEmail(emailRaw);

    const db = getDb();
    ensureMembersProfileColumns(db);
    ensureMembersStripeColumn(db);

    const existing = db.prepare(
      "SELECT email, stripe_customer_id FROM members WHERE member_id = ?"
    ).get(memberId) as { email: string | null; stripe_customer_id: string | null } | undefined;
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const dup = db.prepare(
      "SELECT member_id FROM members WHERE LOWER(TRIM(email)) = ? AND member_id != ? LIMIT 1"
    ).get(email, memberId) as { member_id: string } | undefined;
    if (dup) {
      db.close();
      return NextResponse.json({ error: "Another account already uses this email." }, { status: 409 });
    }

    const prevEmail = (existing.email ?? "").trim().toLowerCase();
    const emailChanged = prevEmail !== email;

    db.prepare(
      `UPDATE members SET
        first_name = ?, last_name = ?, preferred_name = ?, email = ?, phone = ?,
        emergency_contact_name = ?, emergency_contact_phone = ?, emergency_info = ?, spirit_animal = ?,
        pronouns = ?, birthday = ?, mailing_address = ?
       WHERE member_id = ?`
    ).run(
      first_name,
      last_name,
      preferred_name || null,
      emailRaw.trim(),
      phone || null,
      emergency_contact_name || null,
      emergency_contact_phone || null,
      emergency_info || null,
      spirit_animal || null,
      pronouns || null,
      birthday,
      mailing_address || null,
      memberId
    );
    db.close();

    if (emailChanged) {
      const cid = stripeCustomerIdForApi(existing.stripe_customer_id);
      const stripeSecret = process.env.STRIPE_SECRET_KEY;
      if (cid && stripeSecret) {
        try {
          const stripe = new Stripe(stripeSecret);
          await stripe.customers.update(cid, { email: emailRaw.trim() });
        } catch (e) {
          console.error("[member profile] Stripe customer email sync failed:", e);
          /* DB already updated; billing email may be stale until staff fixes in Stripe */
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
