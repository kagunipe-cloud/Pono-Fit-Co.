import { NextRequest, NextResponse } from "next/server";
import { getDb, ensurePaymentFailuresTable, ensureMoneyOwedRemindersTable } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { sendMoneyOwedReminderEmail, isGmailApiConfigured } from "@/lib/email";

export const dynamic = "force-dynamic";

function resolvePublicOrigin(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  if (proto && host) return `${proto}://${host}`.replace(/\/$/, "");
  return request.nextUrl.origin.replace(/\/$/, "");
}

function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return !!(host && user && pass);
}

function isEmailConfigured(): boolean {
  return isSmtpConfigured() || isGmailApiConfigured();
}

function normalizeSubscriptionKey(subscriptionId: string | null | undefined): string {
  return subscriptionId != null && String(subscriptionId).trim() !== "" ? String(subscriptionId).trim() : "";
}

/**
 * POST — admin only. Send money-owed reminder email if this member+subscription has open failures.
 * Body: { member_id: string, subscription_id?: string | null }
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email is not configured. Set SMTP or Gmail API env vars." },
      { status: 503 }
    );
  }

  let body: { member_id?: string; subscription_id?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const memberId = String(body.member_id ?? "").trim();
  if (!memberId) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }
  const subKey = normalizeSubscriptionKey(body.subscription_id);

  const db = getDb();
  ensurePaymentFailuresTable(db);

  const open = db
    .prepare(
      `SELECT 1 FROM payment_failures f
       WHERE f.member_id = ?
         AND COALESCE(TRIM(f.subscription_id), '') = ?
         AND (f.dismissed_at IS NULL OR TRIM(COALESCE(f.dismissed_at, '')) = '')
       LIMIT 1`
    )
    .get(memberId, subKey) as { 1?: number } | undefined;

  if (!open) {
    db.close();
    return NextResponse.json(
      { error: "No open money-owed record for this membership (refresh the page)." },
      { status: 400 }
    );
  }

  const latest = db
    .prepare(
      `SELECT plan_name, amount_cents FROM payment_failures f
       WHERE f.member_id = ?
         AND COALESCE(TRIM(f.subscription_id), '') = ?
         AND (f.dismissed_at IS NULL OR TRIM(COALESCE(f.dismissed_at, '')) = '')
       ORDER BY f.attempted_at DESC LIMIT 1`
    )
    .get(memberId, subKey) as { plan_name: string | null; amount_cents: number | null } | undefined;

  const m = db
    .prepare(
      `SELECT email, first_name, last_name FROM members WHERE member_id = ?`
    )
    .get(memberId) as
    | { email: string | null; first_name: string | null; last_name: string | null }
    | undefined;
  db.close();

  const to = m?.email?.trim();
  if (!to) {
    return NextResponse.json({ error: "Member has no email address on file." }, { status: 400 });
  }

  const nameParts = [m?.first_name, m?.last_name].filter(Boolean).join(" ").trim();
  const memberName = nameParts || memberId;
  const amountDollars = latest?.amount_cents != null ? latest.amount_cents / 100 : 0;

  const base = resolvePublicOrigin(request);
  const payUrl = `${base}/login?next=${encodeURIComponent("/member/membership")}`;

  const result = await sendMoneyOwedReminderEmail({
    to,
    first_name: m?.first_name ?? null,
    member_name: memberName,
    plan_name: latest?.plan_name ?? null,
    amount_dollars: amountDollars,
    pay_url: payUrl,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to send email." },
      { status: 500 }
    );
  }

  const dbWrite = getDb();
  ensureMoneyOwedRemindersTable(dbWrite);
  dbWrite
    .prepare(
      `INSERT INTO money_owed_reminders (member_id, subscription_key, sent_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(member_id, subscription_key) DO UPDATE SET sent_at = excluded.sent_at`
    )
    .run(memberId, subKey);
  dbWrite.close();

  return NextResponse.json({ ok: true, message: `Reminder sent to ${to}.` });
}
