import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables, getPTCreditBalances } from "../../../../../lib/pt-slots";
import { getAdminMemberId } from "../../../../../lib/admin";

export const dynamic = "force-dynamic";

/** GET: PT credit balances keyed by duration_minutes. Admin only. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const id = (await params).id;
  const isPurelyNumeric = /^\d+$/.test(id);

  try {
    const db = getDb();
    const member = (isPurelyNumeric
      ? db.prepare("SELECT member_id FROM members WHERE id = ? OR member_id = ?").get(parseInt(id, 10), id)
      : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(id)) as { member_id: string } | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    ensurePTSlotTables(db);
    const balances = getPTCreditBalances(db, member.member_id);
    db.close();
    return NextResponse.json(balances);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT credits" }, { status: 500 });
  }
}
