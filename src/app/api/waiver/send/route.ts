import { NextRequest, NextResponse } from "next/server";
import { getAdminMemberId } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { sendLiabilityWaiverEmail } from "@/lib/email";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const WAIVER_TOKEN_EXPIRY_DAYS = 14;

/**
 * POST { member_id } — Admin only. Send (or resend) liability waiver link to a member.
 * Resets waiver state so you can test even if already signed.
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const memberId = (body.member_id ?? "").trim();
  if (!memberId) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }

  try {
    const db = getDb();
    const member = db.prepare(
      "SELECT member_id, email, first_name FROM members WHERE member_id = ?"
    ).get(memberId) as { member_id: string; email: string | null; first_name: string | null } | undefined;
    db.close();

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const token = randomBytes(32).toString("hex");
    const expires = new Date();
    expires.setDate(expires.getDate() + WAIVER_TOKEN_EXPIRY_DAYS);

    const db2 = getDb();
    db2.prepare(
      "UPDATE members SET waiver_signed_at = NULL, waiver_token = ?, waiver_token_expires_at = ? WHERE member_id = ?"
    ).run(token, expires.toISOString(), memberId);
    db2.close();

    const origin = request.headers.get("x-forwarded-proto") && request.headers.get("x-forwarded-host")
      ? `${request.headers.get("x-forwarded-proto")}://${request.headers.get("x-forwarded-host")}`
      : request.nextUrl.origin;
    const waiverUrl = `${origin.replace(/\/$/, "")}/sign-waiver?token=${encodeURIComponent(token)}`;

    const emailTo = member.email?.trim();
    if (emailTo) {
      const result = await sendLiabilityWaiverEmail({
        to: emailTo,
        first_name: member.first_name,
        waiver_url: waiverUrl,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error ?? "Failed to send email" }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      message: emailTo ? "Waiver link sent to member's email." : "No email on file; use link below.",
      waiver_url: waiverUrl,
    });
  } catch (err) {
    console.error("[waiver/send]", err);
    return NextResponse.json({ error: "Failed to send waiver" }, { status: 500 });
  }
}
