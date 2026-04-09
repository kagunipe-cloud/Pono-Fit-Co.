import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn, ensureMembersPasswordResetColumns } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  isPasswordResetEmailConfigured,
  issuePasswordResetTokenAndSend,
} from "@/lib/password-reset";

export const dynamic = "force-dynamic";

/**
 * POST — Admin only. Sends the same password-reset email as "Forgot password" for this member.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const id = (await params).id;
  if (!id || id.length < 2) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  if (!isPasswordResetEmailConfigured()) {
    return NextResponse.json(
      { error: "Email is not configured (SMTP or Gmail API). Add credentials in environment variables." },
      { status: 503 }
    );
  }

  try {
    const db = getDb();
    ensureMembersPasswordColumn(db);
    ensureMembersPasswordResetColumns(db);

    const isPurelyNumeric = /^\d+$/.test(id);
    const memberStmt = db.prepare(`
      SELECT m.member_id, m.email, m.first_name, m.password_hash
      FROM members m
      WHERE ${isPurelyNumeric ? "m.id = ? OR m.member_id = ?" : "m.member_id = ?"}
    `);
    const row = (isPurelyNumeric
      ? memberStmt.get(parseInt(id, 10), id)
      : memberStmt.get(id)) as
      | {
          member_id: string;
          email: string | null;
          first_name: string | null;
          password_hash: string | null;
        }
      | undefined;
    db.close();

    if (!row) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const result = await issuePasswordResetTokenAndSend(request, row);
    if (!result.ok) {
      if (result.reason === "no_password") {
        return NextResponse.json(
          {
            error:
              "This member has not set an app password yet. Have them use “Set your password” on the login page, or send a welcome email from Email all members.",
          },
          { status: 400 }
        );
      }
      if (result.reason === "no_email") {
        return NextResponse.json(
          { error: "Add an email address on this profile before sending a reset link." },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Could not send email. Check server logs and email configuration." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Password reset email sent to ${row.email?.trim() ?? "member"}.`,
    });
  } catch (err) {
    console.error("[admin send-password-reset]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
