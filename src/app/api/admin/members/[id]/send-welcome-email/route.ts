import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { sendAppDownloadInviteEmail } from "@/lib/email";
import { isPasswordResetEmailConfigured } from "@/lib/password-reset";

export const dynamic = "force-dynamic";

/**
 * POST — Admin only. Sends the standard welcome email (Member ID + set-password link; install after).
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

    const to = row.email?.trim();
    if (!to) {
      return NextResponse.json(
        { error: "Add an email address on this profile before sending a welcome email." },
        { status: 400 }
      );
    }

    const origin =
      process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
      request.nextUrl.origin.replace(/\/$/, "");

    const result = await sendAppDownloadInviteEmail({
      to,
      first_name: row.first_name,
      origin,
      member_id: row.member_id,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Could not send email. Check server logs and email configuration." },
        { status: 500 }
      );
    }

    const hasPassword = !!(row.password_hash ?? "").trim();
    const message = hasPassword
      ? `Welcome email sent to ${to}. They already have a password — they can sign in at Login; the set-password link in the email only works for first-time setup.`
      : `Welcome email sent to ${to} (set-password + app install steps).`;

    return NextResponse.json({ ok: true, message });
  } catch (err) {
    console.error("[admin send-welcome-email]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
