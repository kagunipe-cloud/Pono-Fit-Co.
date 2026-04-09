import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn, ensureMembersPasswordResetColumns } from "@/lib/db";
import {
  isPasswordResetEmailConfigured,
  issuePasswordResetTokenAndSend,
} from "@/lib/password-reset";

export const dynamic = "force-dynamic";

/**
 * POST { email } — Send password reset link if member exists and has a password.
 * Always returns the same success shape (no email enumeration).
 */
export async function POST(request: NextRequest) {
  const generic = {
    ok: true,
    message: "If an account exists for that email, we sent reset instructions.",
  };

  if (!isPasswordResetEmailConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Password reset email is not configured. Please contact the gym.",
      },
      { status: 503 }
    );
  }

  let email = "";
  try {
    const body = await request.json();
    email = String(body.email ?? "")
      .trim()
      .toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureMembersPasswordColumn(db);
    ensureMembersPasswordResetColumns(db);

    const row = db
      .prepare(
        "SELECT member_id, email, first_name, password_hash FROM members WHERE LOWER(TRIM(email)) = ? LIMIT 1"
      )
      .get(email) as
      | {
          member_id: string;
          email: string | null;
          first_name: string | null;
          password_hash: string | null;
        }
      | undefined;

    if (!row || !(row.password_hash ?? "").trim()) {
      db.close();
      return NextResponse.json(generic);
    }
    db.close();

    const sent = await issuePasswordResetTokenAndSend(request, row);
    if (!sent.ok) {
      if (sent.reason === "send_failed") {
        return NextResponse.json(
          { ok: false, error: "Could not send email. Try again later or contact the gym." },
          { status: 500 }
        );
      }
      return NextResponse.json(generic);
    }

    return NextResponse.json(generic);
  } catch (err) {
    console.error("[forgot-password]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
