import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";
import { hashPassword, verifyPassword } from "../../../../lib/password";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const current_password = String(body.current_password ?? "");
    const new_password = String(body.new_password ?? "").trim();

    if (new_password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const db = getDb();
    ensureMembersPasswordColumn(db);
    const row = db.prepare("SELECT password_hash FROM members WHERE member_id = ?").get(memberId) as {
      password_hash: string | null;
    } | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const hash = row.password_hash;
    if (!hash || !hash.trim()) {
      db.close();
      return NextResponse.json(
        { error: "You have not set a password yet. Use the link from your email to set one first." },
        { status: 400 }
      );
    }

    if (!verifyPassword(current_password, hash)) {
      db.close();
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    const nextHash = hashPassword(new_password);
    db.prepare("UPDATE members SET password_hash = ? WHERE member_id = ?").run(nextHash, memberId);
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
