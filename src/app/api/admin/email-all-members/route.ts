import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { sendMemberEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/** True if SMTP env vars are set so we can send mail. */
function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return !!(host && user && pass);
}

/**
 * GET — returns count of members with an email and whether SMTP is configured.
 * POST — sends one email (subject + text) to every member with an email. Admin only.
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const db = getDb();
  const rows = db
    .prepare("SELECT member_id, email FROM members WHERE TRIM(COALESCE(email, '')) != ''")
    .all() as { member_id: string; email: string }[];
  db.close();
  return NextResponse.json({ count: rows.length, smtp_configured: isSmtpConfigured() });
}

export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let body: { subject?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = String(body.subject ?? "").trim();
  const text = String(body.text ?? "").trim();
  if (!subject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  const db = getDb();
  const rows = db
    .prepare("SELECT member_id, email FROM members WHERE TRIM(COALESCE(email, '')) != ''")
    .all() as { member_id: string; email: string }[];
  db.close();

  if (rows.length === 0) {
    return NextResponse.json({ error: "No members with an email address" }, { status: 400 });
  }

  if (!isSmtpConfigured()) {
    return NextResponse.json(
      { error: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in your environment (e.g. Railway variables) to send email." },
      { status: 503 }
    );
  }

  let sent = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const to = row.email?.trim();
    if (!to) continue;
    const result = await sendMemberEmail(to, subject, text);
    if (result.ok) {
      sent++;
    } else {
      errors.push(`${to}: ${result.error ?? "Failed"}`);
    }
  }

  return NextResponse.json({
    sent,
    total: rows.length,
    failed: rows.length - sent,
    errors: errors.length > 0 ? errors : undefined,
  });
}
