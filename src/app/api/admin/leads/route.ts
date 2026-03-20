import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";

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

export async function GET(request: NextRequest) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = getDb();
    const members = db.prepare(
      "SELECT member_id, first_name, last_name, email, created_at FROM members WHERE email IS NOT NULL AND TRIM(email) != '' ORDER BY created_at DESC"
    ).all() as { member_id: string; first_name: string | null; last_name: string | null; email: string | null; created_at: string | null }[];

    const leads = members.filter((m) => !hasPurchase(db, m.member_id));
    db.close();

    return NextResponse.json(leads);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
  }
}
