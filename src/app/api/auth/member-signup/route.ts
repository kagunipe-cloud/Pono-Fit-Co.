import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn } from "../../../../lib/db";
import { hashPassword } from "../../../../lib/password";
import { setMemberSession } from "../../../../lib/session";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.SESSION_SECRET?.trim();
    if (!secret || secret.length < 16) {
      return NextResponse.json(
        { error: "Server configuration error: SESSION_SECRET must be set and at least 16 characters." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const email = (body.email ?? "").trim().toLowerCase();
    const password = (body.password ?? "").trim();
    const firstName = (body.first_name ?? "").trim() || null;
    const lastName = (body.last_name ?? "").trim() || null;

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const db = getDb();
    ensureMembersPasswordColumn(db);
    const existing = db.prepare("SELECT member_id FROM members WHERE LOWER(TRIM(email)) = ? LIMIT 1").get(email);
    if (existing) {
      db.close();
      return NextResponse.json(
        { error: "An account with this email already exists. Sign in or set your password." },
        { status: 400 }
      );
    }

    const memberId = randomUUID().slice(0, 8);
    const passwordHash = hashPassword(password);
    db.prepare(
      "INSERT INTO members (member_id, first_name, last_name, email, role, password_hash) VALUES (?, ?, ?, ?, 'Member', ?)"
    ).run(memberId, firstName ?? "", lastName ?? "", email, passwordHash);
    db.close();

    await setMemberSession(memberId);

    return NextResponse.json({
      success: true,
      member_id: memberId,
      role: "Member",
      privacy_terms_accepted: false,
      needs_waiver: false,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Signup failed" },
      { status: 500 }
    );
  }
}
