import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersProfileColumns, ensureMembersAccountDeletedAtColumn } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { memberPhoneOnFile, normalizeMemberPhoneInput } from "../../../../lib/member-phone";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const db = getDb();
    ensureMembersProfileColumns(db);
    ensureMembersAccountDeletedAtColumn(db);
    const row = db
      .prepare("SELECT phone, account_deleted_at FROM members WHERE member_id = ?")
      .get(memberId) as { phone: string | null; account_deleted_at: string | null } | undefined;
    db.close();

    if (!row) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if ((row.account_deleted_at ?? "").trim()) {
      return NextResponse.json({ error: "Account closed" }, { status: 401 });
    }

    const phone = row.phone ?? "";
    return NextResponse.json({ phone, has_phone: memberPhoneOnFile(phone) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const db0 = getDb();
    ensureMembersAccountDeletedAtColumn(db0);
    const closed = db0.prepare("SELECT account_deleted_at FROM members WHERE member_id = ?").get(memberId) as
      | { account_deleted_at: string | null }
      | undefined;
    db0.close();
    if ((closed?.account_deleted_at ?? "").trim()) {
      return NextResponse.json({ error: "Account closed" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = normalizeMemberPhoneInput(String(body.phone ?? ""));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 });
    }

    const db = getDb();
    ensureMembersProfileColumns(db);
    const updated = db.prepare("UPDATE members SET phone = ? WHERE member_id = ?").run(parsed.value, memberId);
    db.close();

    if (updated.changes === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, phone: parsed.value, has_phone: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
