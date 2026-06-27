import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersAutoRenewColumn } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { setMemberAutoRenew } from "../../../../lib/auto-renew-events";

export const dynamic = "force-dynamic";

/** PATCH body: { enabled: boolean }. Toggle auto-renew for the logged-in member. */
export async function PATCH(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const enabled = body.enabled === true || body.enabled === "true" || body.enabled === 1;

    const db = getDb();
    ensureMembersAutoRenewColumn(db);
    const row = db.prepare("SELECT 1 FROM members WHERE member_id = ?").get(memberId);
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const { autoRenew } = setMemberAutoRenew(db, {
      memberId,
      enabled,
      changedByMemberId: memberId,
      source: "member",
    });
    db.close();

    return NextResponse.json({ ok: true, auto_renew: autoRenew === 1 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
