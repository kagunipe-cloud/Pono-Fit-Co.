import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { sendAppDownloadInviteEmail, isGmailApiConfigured } from "@/lib/email";

export const dynamic = "force-dynamic";

function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return !!(host && user && pass);
}

function isEmailConfigured(): boolean {
  return isSmtpConfigured() || isGmailApiConfigured();
}

/**
 * GET — returns members who have an email (for the welcome-email member picker). Admin only.
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT member_id, email, first_name, last_name FROM members WHERE TRIM(COALESCE(email, '')) != '' ORDER BY last_name ASC, first_name ASC"
    )
    .all() as { member_id: string; email: string; first_name: string | null; last_name: string | null }[];
  db.close();
  return NextResponse.json({ members: rows });
}

/**
 * POST — sends welcome email (install link, Member ID, set-password link) to members.
 * Body: {} = all members with email; { member_ids: string[] } = only those members. Admin only.
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email not configured. Set SMTP or Gmail API env vars first." },
      { status: 503 }
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;

  let body: { member_ids?: string[] } = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    // empty body is ok
  }
  const filterIds = Array.isArray(body.member_ids)
    ? body.member_ids.map((id) => String(id).trim()).filter(Boolean)
    : null;

  const db = getDb();
  let rows = db
    .prepare(
      "SELECT member_id, email, first_name FROM members WHERE TRIM(COALESCE(email, '')) != ''"
    )
    .all() as { member_id: string; email: string; first_name: string | null }[];
  if (filterIds && filterIds.length > 0) {
    const set = new Set(filterIds);
    rows = rows.filter((r) => set.has(r.member_id));
  }
  db.close();

  if (rows.length === 0) {
    return NextResponse.json({ error: "No members with an email address to send to" }, { status: 400 });
  }

  const results = await Promise.allSettled(
    rows.map((row) =>
      sendAppDownloadInviteEmail({
        to: row.email.trim(),
        first_name: row.first_name,
        origin,
        member_id: row.member_id,
      })
    )
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
