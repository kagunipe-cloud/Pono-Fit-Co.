import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn, ensureMembersPasswordResetColumns } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

/**
 * GET ?token= — validate token (for reset page).
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ valid: false, error: "Missing token" }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureMembersPasswordResetColumns(db);
    const row = db
      .prepare(
        "SELECT member_id, password_reset_expires_at FROM members WHERE password_reset_token = ? LIMIT 1"
      )
      .get(token) as { member_id: string; password_reset_expires_at: string | null } | undefined;
    db.close();

    if (!row?.password_reset_expires_at?.trim()) {
      return NextResponse.json({ valid: false, error: "Invalid or expired link" });
    }
    const exp = new Date(row.password_reset_expires_at.trim()).getTime();
    if (!Number.isFinite(exp) || exp < Date.now()) {
      return NextResponse.json({ valid: false, error: "This link has expired. Request a new one from Forgot password." });
    }

    return NextResponse.json({ valid: true });
  } catch (err) {
    console.error("[password-reset GET]", err);
    return NextResponse.json({ valid: false, error: "Failed to validate" }, { status: 500 });
  }
}

/**
 * POST { token, password } — set new password and clear reset token.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = String(body.token ?? "").trim();
    const password = String(body.password ?? "").trim();

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const db = getDb();
    ensureMembersPasswordColumn(db);
    ensureMembersPasswordResetColumns(db);

    const row = db
      .prepare(
        "SELECT member_id, password_reset_expires_at FROM members WHERE password_reset_token = ? LIMIT 1"
      )
      .get(token) as { member_id: string; password_reset_expires_at: string | null } | undefined;

    if (!row?.password_reset_expires_at?.trim()) {
      db.close();
      return NextResponse.json({ error: "Invalid or expired link. Request a new reset from the login page." }, { status: 400 });
    }
    const exp = new Date(row.password_reset_expires_at.trim()).getTime();
    if (!Number.isFinite(exp) || exp < Date.now()) {
      db.close();
      return NextResponse.json({ error: "This link has expired. Request a new one." }, { status: 400 });
    }

    const password_hash = hashPassword(password);
    db.prepare(
      "UPDATE members SET password_hash = ?, password_reset_token = NULL, password_reset_expires_at = NULL WHERE member_id = ?"
    ).run(password_hash, row.member_id);
    db.close();

    return NextResponse.json({
      ok: true,
      message: "Password updated. You can sign in with your new password.",
    });
  } catch (err) {
    console.error("[password-reset POST]", err);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }
}
