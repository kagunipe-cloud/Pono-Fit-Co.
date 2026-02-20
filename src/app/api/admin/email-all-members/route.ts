import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { sendMemberEmail, isGmailApiConfigured } from "@/lib/email";

export const dynamic = "force-dynamic";

/** True if SMTP env vars are set so we can send mail. */
function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return !!(host && user && pass);
}

/** True if we can send (SMTP or Gmail API). Gmail API uses HTTPS so it works when SMTP is blocked. */
function isEmailConfigured(): boolean {
  return isSmtpConfigured() || isGmailApiConfigured();
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
  return NextResponse.json({ count: rows.length, smtp_configured: isEmailConfigured() });
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

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email not configured. Set SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS) or Gmail API (GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN, GMAIL_FROM_EMAIL). Gmail API uses HTTPS and works when SMTP is blocked." },
      { status: 503 }
    );
  }

  // Send all in parallel so the request finishes before server timeout (sequential was 2–3s per recipient).
  const results = await Promise.allSettled(
    rows.map((row) => {
      const to = row.email?.trim();
      if (!to) return Promise.resolve({ ok: false as const, error: "No address" });
      return sendMemberEmail(to, subject, text);
    })
  );

  let sent = 0;
  const errors: string[] = [];
  results.forEach((outcome, i) => {
    const to = rows[i]?.email?.trim();
    if (!to) return;
    if (outcome.status === "fulfilled" && outcome.value.ok) {
      sent++;
    } else {
      const err = outcome.status === "fulfilled" ? outcome.value.error : String(outcome.reason);
      errors.push(`${to}: ${err ?? "Failed"}`);
    }
  });

  return NextResponse.json({
    sent,
    total: rows.length,
    failed: rows.length - sent,
    errors: errors.length > 0 ? errors : undefined,
  });
}
