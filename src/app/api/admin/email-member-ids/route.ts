import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn, ensureMembersWaiverColumns } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { sendAppDownloadInviteEmail, isGmailApiConfigured } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return !!(host && user && pass);
}

function isEmailConfigured(): boolean {
  return isSmtpConfigured() || isGmailApiConfigured();
}

/** Union: still need app password and/or liability waiver (overlap expected). */
function sqlNeedsPasswordOrWaiver(): string {
  return `(
    TRIM(COALESCE(password_hash, '')) = ''
    OR TRIM(COALESCE(waiver_signed_at, '')) = ''
  )`;
}

/**
 * GET — members with email (for welcome-email picker). Query: filter=needs_password_or_waiver
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const filter = request.nextUrl.searchParams.get("filter")?.trim();
  const onboarding = filter === "needs_password_or_waiver";

  const db = getDb();
  ensureMembersPasswordColumn(db);
  ensureMembersWaiverColumns(db);

  let sql = `SELECT member_id, email, first_name, last_name FROM members WHERE TRIM(COALESCE(email, '')) != ''`;
  if (onboarding) {
    sql += ` AND ${sqlNeedsPasswordOrWaiver()}`;
  }
  sql += ` ORDER BY last_name ASC, first_name ASC`;

  const rows = db.prepare(sql).all() as {
    member_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
  }[];
  db.close();
  return NextResponse.json({ members: rows, filter: onboarding ? "needs_password_or_waiver" : "all" });
}

/**
 * POST — welcome email (install link, Member ID, set-password link).
 * Body: { filter?: "all" | "needs_password_or_waiver" } — onboarding filter = missing password and/or waiver.
 * { member_ids?: string[] } — optional subset (still applies filter when set).
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

  let body: { member_ids?: string[]; filter?: string } = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    // empty body is ok
  }
  const filterIds = Array.isArray(body.member_ids)
    ? body.member_ids.map((id) => String(id).trim()).filter(Boolean)
    : null;
  const onboarding =
    body.filter === "needs_password_or_waiver";

  const db = getDb();
  ensureMembersPasswordColumn(db);
  ensureMembersWaiverColumns(db);

  let sql = `SELECT member_id, email, first_name FROM members WHERE TRIM(COALESCE(email, '')) != ''`;
  if (onboarding) {
    sql += ` AND ${sqlNeedsPasswordOrWaiver()}`;
  }
  let rows = db.prepare(sql).all() as { member_id: string; email: string; first_name: string | null }[];
  db.close();

  if (filterIds && filterIds.length > 0) {
    const set = new Set(filterIds);
    rows = rows.filter((r) => set.has(r.member_id));
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "No members with an email address to send to" }, { status: 400 });
  }

  const DELAY_MS = 1500;
  let sent = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const to = row.email?.trim();
    if (!to) continue;
    const result = await sendAppDownloadInviteEmail({
      to,
      first_name: row.first_name,
      origin,
      member_id: row.member_id,
    });
    if (result.ok) {
      sent++;
    } else {
      errors.push(`${to}: ${result.error ?? "Failed"}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  return NextResponse.json({
    sent,
    total: rows.length,
    failed: rows.length - sent,
    errors: errors.length > 0 ? errors : undefined,
  });
}
