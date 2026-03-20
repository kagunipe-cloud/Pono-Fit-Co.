import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn } from "../../../../lib/db";
import { verifyPassword } from "../../../../lib/password";
import { setMemberSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

function hasPurchase(db: ReturnType<typeof getDb>, memberId: string): boolean {
  const checks = [
    "SELECT 1 FROM subscriptions WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM class_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM occurrence_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_trainer_specific_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_open_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM class_credit_ledger WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_credit_ledger WHERE member_id = ? LIMIT 1",
  ];
  for (const sql of checks) {
    try {
      if (db.prepare(sql).get(memberId)) return true;
    } catch {
      /* table may not exist */
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.SESSION_SECRET?.trim();
    if (!secret || secret.length < 16) {
      return NextResponse.json(
        { error: "Server configuration error: SESSION_SECRET must be set and at least 16 characters. Add it to .env.local and restart the server." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";

    if (!email) {
      return NextResponse.json(
        { error: "Email required" },
        { status: 400 }
      );
    }
    if (typeof password !== "string" || !password) {
      return NextResponse.json(
        { error: "Password required" },
        { status: 400 }
      );
    }

    const db = getDb();
    ensureMembersPasswordColumn(db);
    const member = db
      .prepare(
        "SELECT member_id, email, password_hash, role, waiver_signed_at, privacy_terms_accepted_at FROM members WHERE LOWER(TRIM(email)) = ? LIMIT 1"
      )
      .get(email) as
      | { member_id: string; email: string | null; password_hash: string | null; role: string | null; waiver_signed_at: string | null; privacy_terms_accepted_at: string | null }
      | undefined;

    if (!member) {
      db.close();
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    if (!member.password_hash) {
      db.close();
      return NextResponse.json(
        { error: "Password not set", code: "PASSWORD_NOT_SET", member_id: member.member_id },
        { status: 400 }
      );
    }
    if (!verifyPassword(password, member.password_hash)) {
      db.close();
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    await setMemberSession(member.member_id);
    const role = member.role ?? "Member";
    const waiverSigned = !!(member.waiver_signed_at ?? "").trim();
    const privacyTermsAccepted = !!(member.privacy_terms_accepted_at ?? "").trim();
    const purchased = hasPurchase(db, member.member_id);
    const needsWaiver = purchased && !waiverSigned;
    db.close();

    return NextResponse.json({
      success: true,
      member_id: member.member_id,
      role,
      privacy_terms_accepted: privacyTermsAccepted,
      needs_waiver: needsWaiver,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Login failed" },
      { status: 500 }
    );
  }
}
