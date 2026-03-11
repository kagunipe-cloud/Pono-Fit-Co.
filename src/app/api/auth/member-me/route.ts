import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

function hasPurchase(db: ReturnType<typeof getDb>, memberId: string): boolean {
  const checks = [
    "SELECT 1 FROM subscriptions WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM class_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM occurrence_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_block_bookings WHERE member_id = ? LIMIT 1",
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

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const db = getDb();
    const member = db.prepare(
      "SELECT member_id, first_name, last_name, email, role, waiver_signed_at, privacy_terms_accepted_at FROM members WHERE member_id = ?"
    ).get(memberId) as {
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      role: string | null;
      waiver_signed_at: string | null;
      privacy_terms_accepted_at: string | null;
    } | undefined;

    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 401 });
    }

    const waiverSigned = !!(member.waiver_signed_at ?? "").trim();
    const privacyTermsAccepted = !!(member.privacy_terms_accepted_at ?? "").trim();
    const purchased = hasPurchase(db, memberId);
    const needsWaiver = purchased && !waiverSigned;
    db.close();

    return NextResponse.json({
      member_id: member.member_id,
      email: member.email,
      first_name: member.first_name,
      last_name: member.last_name,
      name: [member.first_name, member.last_name].filter(Boolean).join(" ") || "Member",
      role: member.role ?? "Member",
      waiver_signed_at: member.waiver_signed_at ?? null,
      privacy_terms_accepted_at: member.privacy_terms_accepted_at ?? null,
      privacy_terms_accepted: privacyTermsAccepted,
      needs_waiver: needsWaiver,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
