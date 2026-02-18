import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn } from "../../../../lib/db";
import { verifyPassword } from "../../../../lib/password";
import { setMemberSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

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
        "SELECT member_id, email, password_hash, role FROM members WHERE LOWER(TRIM(email)) = ? LIMIT 1"
      )
      .get(email) as
      | { member_id: string; email: string | null; password_hash: string | null; role: string | null }
      | undefined;
    db.close();

    if (!member) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    if (!member.password_hash) {
      return NextResponse.json(
        { error: "Password not set", code: "PASSWORD_NOT_SET", member_id: member.member_id },
        { status: 400 }
      );
    }
    if (!verifyPassword(password, member.password_hash)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    await setMemberSession(member.member_id);
    const role = member.role ?? "Member";
    return NextResponse.json({ success: true, member_id: member.member_id, role });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Login failed" },
      { status: 500 }
    );
  }
}
