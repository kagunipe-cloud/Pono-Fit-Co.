import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersAutoRenewColumn } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";

export const dynamic = "force-dynamic";

/** PATCH body: { enabled: boolean }. Admin only. Set auto-renew for a member. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const id = (await params).id;
  const body = await request.json().catch(() => ({}));
  const enabled = body.enabled === true || body.enabled === "true" || body.enabled === 1;

  const db = getDb();
  ensureMembersAutoRenewColumn(db);
  const isPurelyNumeric = /^\d+$/.test(id);
  const member = (isPurelyNumeric
    ? db.prepare("SELECT member_id FROM members WHERE id = ?").get(parseInt(id, 10))
    : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(id)) as { member_id: string } | undefined;
  if (!member) {
    db.close();
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  db.prepare("UPDATE members SET auto_renew = ? WHERE member_id = ?").run(enabled ? 1 : 0, member.member_id);
  db.close();

  return NextResponse.json({ ok: true, auto_renew: enabled });
}
