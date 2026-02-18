import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn } from "../../../../lib/db";
import { hashPassword } from "../../../../lib/password";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const password = (body.password ?? "").trim();

    if (!member_id || !email) {
      return NextResponse.json(
        { error: "Member ID and email required" },
        { status: 400 }
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const db = getDb();
    ensureMembersPasswordColumn(db);
    const row = db
      .prepare(
        "SELECT member_id, email, password_hash FROM members WHERE member_id = ?"
      )
      .get(member_id) as
      | { member_id: string; email: string | null; password_hash: string | null }
      | undefined;
    db.close();

    if (!row) {
      return NextResponse.json({ error: "Member not found" }, { status: 401 });
    }
    const memberEmail = (row.email ?? "").trim().toLowerCase();
    if (memberEmail !== email) {
      return NextResponse.json(
        { error: "Email does not match this member" },
        { status: 401 }
      );
    }
    if (row.password_hash) {
      return NextResponse.json(
        { error: "Password already set. Sign in with your email and password." },
        { status: 400 }
      );
    }

    const password_hash = hashPassword(password);
    const db2 = getDb();
    db2
      .prepare("UPDATE members SET password_hash = ? WHERE member_id = ?")
      .run(password_hash, member_id);
    db2.close();

    return NextResponse.json({
      success: true,
      message: "Password set. You can now sign in with your email and password.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to set password" },
      { status: 500 }
    );
  }
}
