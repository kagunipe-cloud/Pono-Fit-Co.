import { NextResponse } from "next/server";
import { getDb, ensureMembersAccountDeletedAtColumn } from "../../../../lib/db";
import { getMemberIdFromSession, clearMemberSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** GET: Returns { ok, role?, member_id? } for middleware. No redirect. */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ ok: false });
    }
    const db = getDb();
    ensureMembersAccountDeletedAtColumn(db);
    const row = db.prepare("SELECT role, account_deleted_at FROM members WHERE member_id = ?").get(memberId) as
      | { role: string | null; account_deleted_at: string | null }
      | undefined;
    db.close();
    if (!row) {
      await clearMemberSession();
      return NextResponse.json({ ok: false, account_closed: true });
    }
    if ((row.account_deleted_at ?? "").trim()) {
      await clearMemberSession();
      return NextResponse.json({ ok: false, account_closed: true });
    }
    const role = row.role ?? "Member";
    return NextResponse.json({ ok: true, role, member_id: memberId });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
