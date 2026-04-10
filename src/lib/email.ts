import nodemailer from "nodemailer";
import { getDb } from "@/lib/db";
import { formatDateOnlyInAppTz } from "@/lib/app-timezone";
import { BRAND } from "@/lib/branding";

let transporter: nodemailer.Transporter | null = null;

function getEmailSetting(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    db.close();
    return row?.value?.trim() ?? null;
  } catch {
    return null;
  }
}

function applyPlaceholders(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  }
  return out;
}

/** True if Gmail API OAuth env vars are set. Sending then uses HTTPS (port 443) so it works when SMTP is blocked. */
export function isGmailApiConfigured(): boolean {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN?.trim();
  const from = process.env.GMAIL_FROM_EMAIL?.trim();
  return !!(clientId && clientSecret && refreshToken && from);
}

/** Exchange refresh token for access token. */
async function getGmailAccessToken(): Promise<string | null> {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    console.error("[email] Gmail token exchange failed:", res.status, data.error ?? "", data.error_description ?? "");
    return null;
  }
  return data.access_token;
}

/** Send one email via Gmail API (HTTPS). Uses port 443 so it works when SMTP is blocked. */
async function sendViaGmailApi(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const from = process.env.GMAIL_FROM_EMAIL?.trim();
  if (!from) return { ok: false, error: "GMAIL_FROM_EMAIL not set" };

  const accessToken = await getGmailAccessToken();
  if (!accessToken) return { ok: false, error: "Failed to get Gmail access token" };

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject.replace(/\r?\n/g, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
  ];
  const raw = lines.join("\r\n");
  const rawBase64 = Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: rawBase64 }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, error: `Gmail API ${res.status}: ${errBody.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Gmail `users.messages.send` rejects long or multi-line folded `Bcc` headers ("Invalid Bcc header").
 * Keep each message to a small number of addresses so one `Bcc:` line stays under RFC limits and parses cleanly.
 */
function getGmailBccChunkSize(): number {
  const raw = process.env.EMAIL_GMAIL_BCC_CHUNK?.trim();
  const n = raw ? parseInt(raw, 10) : 12;
  if (Number.isNaN(n) || n < 1) return 12;
  return Math.min(50, n);
}

/**
 * One broadcast message with BCC recipients (mailing-list style). Recipients do not see each other.
 * Gmail API: `To` must be a real address (use sender); `Bcc` must be a single short line (batch via {@link getGmailBccChunkSize}).
 */
async function sendViaGmailApiBcc(
  bcc: string[],
  subject: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const from = process.env.GMAIL_FROM_EMAIL?.trim();
  if (!from) return { ok: false, error: "GMAIL_FROM_EMAIL not set" };
  if (bcc.length === 0) return { ok: false, error: "No BCC recipients" };

  const accessToken = await getGmailAccessToken();
  if (!accessToken) return { ok: false, error: "Failed to get Gmail access token" };

  const bccList = bcc.map((e) => e.trim()).filter(Boolean).join(", ");
  const bccHeaderLine = `Bcc: ${bccList}`;
  if (bccHeaderLine.length > 990) {
    return {
      ok: false,
      error: `Bcc line too long (${bccHeaderLine.length} chars, max ~990). Lower EMAIL_GMAIL_BCC_CHUNK (currently ${getGmailBccChunkSize()} addresses per message).`,
    };
  }
  const lines = [
    `From: ${from}`,
    `To: ${from}`,
    bccHeaderLine,
    `Subject: ${subject.replace(/\r?\n/g, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
  ];
  const raw = lines.join("\r\n");
  const rawBase64 = Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: rawBase64 }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, error: `Gmail API ${res.status}: ${errBody.slice(0, 200)}` };
  }
  return { ok: true };
}

/** Default chunk size: one batch can cover typical full member lists (~400) in a single send. */
const BULK_BCC_DEFAULT_CHUNK = 500;

function getBulkBccChunkSize(): number {
  const raw = process.env.EMAIL_BULK_BCC_CHUNK_SIZE?.trim();
  const n = raw ? parseInt(raw, 10) : BULK_BCC_DEFAULT_CHUNK;
  if (Number.isNaN(n) || n < 1) return BULK_BCC_DEFAULT_CHUNK;
  /** Upper bound avoids absurd MIME lines; Gmail often allows ~500 recipients per message (varies by account). */
  const max = 2000;
  return Math.min(max, n);
}

/**
 * Send the same subject/body to many addresses using chunked BCC (one SMTP/API message per chunk).
 * Avoids one send per recipient, which exhausts Gmail API daily limits on large directories.
 * Does not support per-recipient placeholders — use {@link sendMemberEmail} for that.
 */
export async function sendBulkBroadcastEmail(
  recipients: string[],
  subject: string,
  text: string
): Promise<{ sent: number; failed: number; errors: string[]; batches: number }> {
  const unique = [...new Set(recipients.map((e) => e.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { sent: 0, failed: 0, errors: ["No recipients"], batches: 0 };
  }

  const chunkSize = getBulkBccChunkSize();
  const errors: string[] = [];
  let sent = 0;
  let batches = 0;

  if (isGmailApiConfigured()) {
    const gmailChunk = getGmailBccChunkSize();
    for (let i = 0; i < unique.length; i += gmailChunk) {
      const chunk = unique.slice(i, i + gmailChunk);
      batches++;
      const result = await sendViaGmailApiBcc(chunk, subject, text);
      if (result.ok) {
        sent += chunk.length;
      } else {
        errors.push(`Batch ${batches} (${chunk.length} addresses): ${result.error ?? "Failed"}`);
      }
      if (i + gmailChunk < unique.length) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    return { sent, failed: unique.length - sent, errors, batches };
  }

  const trans = getTransporter();
  if (!trans) {
    return { sent: 0, failed: unique.length, errors: ["SMTP not configured"], batches: 0 };
  }
  const fromAddr = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@localhost";

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    batches++;
    try {
      await trans.sendMail({
        from: fromAddr,
        bcc: chunk,
        subject,
        text,
      });
      sent += chunk.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${batches} (${chunk.length} addresses): ${msg}`);
    }
    if (i + chunkSize < unique.length) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return { sent, failed: unique.length - sent, errors, batches };
}

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn("[email] SMTP_HOST, SMTP_USER, SMTP_PASS not set — skipping send");
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    /** Avoid hanging forever when SMTP is unreachable (client was stuck on "Sending…"). */
    connectionTimeout: 25_000,
    greetingTimeout: 25_000,
    socketTimeout: 60_000,
  });
  return transporter;
}

/** Send an email to staff (STAFF_EMAIL). Uses Gmail API if configured, else SMTP. */
export async function sendStaffEmail(subject: string, text: string): Promise<boolean> {
  const staffEmail = process.env.STAFF_EMAIL;
  if (!staffEmail) return false;
  if (isGmailApiConfigured()) {
    const result = await sendViaGmailApi(staffEmail, subject, text);
    return result.ok;
  }
  const trans = getTransporter();
  if (!trans) return false;
  try {
    await trans.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@localhost",
      to: staffEmail,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error("[email] sendStaffEmail failed:", err);
    return false;
  }
}

/** Send an email to a member. Uses Gmail API if configured (HTTPS), else SMTP. Returns { ok, error? }. */
export async function sendMemberEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!to?.trim()) return { ok: false, error: "No recipient" };
  const toTrim = to.trim();

  if (isGmailApiConfigured()) {
    return sendViaGmailApi(toTrim, subject, text);
  }

  const trans = getTransporter();
  if (!trans) return { ok: false, error: "SMTP not configured" };
  try {
    await trans.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@localhost",
      to: toTrim,
      subject,
      text,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] sendMemberEmail failed:", msg);
    return { ok: false, error: msg };
  }
}

/** Format HH:MM or HH:MM:SS for plain-text email (locale 12h). */
export function formatBookingTimeForEmail(timeRaw: string | null | undefined): string {
  const t = (timeRaw ?? "").trim();
  if (!t) return "—";
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return t;
  const d = new Date(2000, 0, 1, h, min, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Trainer full name from `members.member_id`, or null. */
export function getTrainerDisplayNameFromMemberId(
  db: ReturnType<typeof getDb>,
  trainerMemberId: string | null | undefined
): string | null {
  const id = (trainerMemberId ?? "").trim();
  if (!id) return null;
  const row = db.prepare("SELECT first_name, last_name FROM members WHERE member_id = ?").get(id) as
    | { first_name: string | null; last_name: string | null }
    | undefined;
  const n = row ? [row.first_name, row.last_name].filter(Boolean).join(" ").trim() : "";
  return n || null;
}

/** Default templates (match admin Settings → email defaults when DB empty). */
const BOOKING_EMAIL_FALLBACK = {
  initial: {
    subject: "Booking confirmed: {{session_title}} — {{date}}",
    body: `Hi{{first_name}},

Your booking is confirmed.

{{session_title}} ({{kind_label}})
Date: {{date}}
Time: {{time}}
Trainer: {{trainer}}

You can view details in the {{brand_short}} app.

— {{brand_name}}`,
  },
  trainer_assigned: {
    subject: "Trainer assigned: {{session_title}} — {{date}}",
    body: `Hi{{first_name}},

A trainer has been assigned to your session.

{{session_title}} ({{kind_label}})
Date: {{date}}
Time: {{time}}
Trainer: {{trainer}}

You can view details in the {{brand_short}} app.

— {{brand_name}}`,
  },
} as const;

/**
 * Confirmation to the member who was booked (class or PT).
 * Uses Settings → Email templates when set (`email_booking_confirmation_*` or `email_booking_trainer_assigned_*`).
 * Placeholders: {{first_name}} (leading space if set), {{session_title}}, {{kind_label}}, {{date}}, {{time}}, {{trainer}}, {{brand_short}}, {{brand_name}}
 */
export async function sendMemberBookingConfirmationEmail(params: {
  to: string;
  memberFirstName?: string | null;
  kind: "class" | "pt";
  sessionTitle: string;
  dateYmd: string;
  timeRaw: string;
  trainerDisplayName: string | null;
  timeZone: string;
  /** Use when staff assigns a trainer after an open booking (second email). Falls back to confirmation template if trainer-assigned template is empty. */
  variant?: "initial" | "trainer_assigned";
}): Promise<{ ok: boolean; error?: string }> {
  const dateLine = params.dateYmd.trim()
    ? formatDateOnlyInAppTz(
        params.dateYmd,
        { weekday: "short", month: "short", day: "numeric", year: "numeric" },
        params.timeZone
      )
    : "—";
  const timeLine = formatBookingTimeForEmail(params.timeRaw);
  const trainerLine = params.trainerDisplayName?.trim() || "TBD";
  const kindLabel = params.kind === "class" ? "Class" : "PT session";
  const variant = params.variant ?? "initial";
  const fn = params.memberFirstName?.trim() ? ` ${params.memberFirstName.trim()}` : "";

  const vars: Record<string, string> = {
    first_name: fn,
    session_title: params.sessionTitle,
    kind_label: kindLabel,
    date: dateLine,
    time: timeLine,
    trainer: trainerLine,
    brand_short: BRAND.shortName,
    brand_name: BRAND.name,
  };

  const subKey =
    variant === "trainer_assigned" ? "email_booking_trainer_assigned_subject" : "email_booking_confirmation_subject";
  const bodyKey =
    variant === "trainer_assigned" ? "email_booking_trainer_assigned_body" : "email_booking_confirmation_body";

  let subjectTpl = getEmailSetting(subKey);
  let bodyTpl = getEmailSetting(bodyKey);
  if (variant === "trainer_assigned") {
    if (!subjectTpl) subjectTpl = getEmailSetting("email_booking_confirmation_subject");
    if (!bodyTpl) bodyTpl = getEmailSetting("email_booking_confirmation_body");
  }
  if (!subjectTpl) subjectTpl = BOOKING_EMAIL_FALLBACK[variant].subject;
  if (!bodyTpl) bodyTpl = BOOKING_EMAIL_FALLBACK[variant].body;

  const subject = applyPlaceholders(subjectTpl, vars);
  const text = applyPlaceholders(bodyTpl, vars);
  return sendMemberEmail(params.to, subject, text);
}

/** Email recipient a redeem link for a gifted membership / pass (purchaser paid; access activates when they redeem). */
export async function sendGiftPassEmail(params: {
  to: string;
  planName: string;
  redeemUrl: string;
  purchaserFirstName?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const from = params.purchaserFirstName?.trim();
  const intro = from ? `${from} sent you a gift from ${BRAND.name}.\n\n` : "";
  const text = `Hi,

${intro}You received: ${params.planName}

Redeem your pass — create an account or log in with this same email address (${params.to}):
${params.redeemUrl}

Mahalo,
${BRAND.name}`;
  return sendMemberEmail(params.to, `Your gift: ${params.planName}`, text);
}

/** Send membership expiring in 2 days reminder. Card on file: remind them they're set if card is valid. No card: payment due on expiry date. */
export async function sendMembershipExpiryReminder(params: {
  to: string;
  first_name?: string | null;
  expiry_date: string;
  has_card_on_file: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const cardMessage = params.has_card_on_file
    ? `You have a card on file—as long as it's still valid, you're all set and we'll charge it automatically. If your card has changed or expired, please update it in the app before ${params.expiry_date} so we can process your renewal.`
    : `Payment is due by then to continue your access. You can renew in the app or at the front desk.`;
  const vars = {
    first_name: params.first_name ?? "",
    expiry_date: params.expiry_date,
    card_message: cardMessage,
  };
  const customSubject = getEmailSetting("email_membership_expiry_subject");
  const customBody = getEmailSetting("email_membership_expiry_body");
  const subject = customSubject ? applyPlaceholders(customSubject, vars) : "Your membership is expiring soon";
  const closing = "\n\nMahalo Nui Loa,\n\nB & P";
  const defaultText = params.has_card_on_file
    ? `Aloha,\n\nBekah & Perry with Pono Fit Co. here! We're just emailing to let you know that your membership expires on ${params.expiry_date}. You have a card on file—as long as it's still valid, you're all set and we'll charge it automatically. If your card has changed or expired, please update it in the app before ${params.expiry_date} so we can process your renewal.${closing}`
    : `Aloha,\n\nBekah & Perry with Pono Fit Co. here! We're just emailing to let you know that your membership expires on ${params.expiry_date}. Payment is due by then to continue your access. You can renew in the app or at the front desk.${closing}`;
  const text = customBody ? applyPlaceholders(customBody, vars) : defaultText;
  return sendMemberEmail(params.to, subject, text);
}

/** Post-purchase receipt / confirmation to member. Includes app download and set-password links. */
export async function sendPostPurchaseEmail(params: {
  to: string;
  member_id: string;
  first_name?: string | null;
  origin: string;
  /** Receipt details shown at bottom of email */
  receipt?: {
    date: string;
    total: string;
    items: { name: string; quantity: number; price: string }[];
  };
}): Promise<{ ok: boolean; error?: string }> {
  const origin = params.origin.replace(/\/$/, "");
  const installUrl = `${origin}/install`;
  const memberId = params.member_id.trim();
  const setPasswordUrl = `${origin}/set-password?member_id=${encodeURIComponent(memberId)}&email=${encodeURIComponent(params.to)}`;
  let receiptBlock = "";
  if (params.receipt && params.receipt.items.length > 0) {
    receiptBlock = `\n\n---\n\nReceipt\nDate: ${params.receipt.date}\n\n`;
    for (const it of params.receipt.items) {
      receiptBlock += `${it.name} × ${it.quantity} — ${it.price}\n`;
    }
    receiptBlock += `\nTotal: ${params.receipt.total}\n`;
  }
  const vars: Record<string, string> = {
    first_name: params.first_name ? ` ${params.first_name}` : "",
    member_id: memberId,
    email: params.to,
    origin,
    install_url: installUrl,
    set_password_url: setPasswordUrl,
    receipt: receiptBlock,
  };
  const customSubject = getEmailSetting("email_post_purchase_subject");
  const customBody = getEmailSetting("email_post_purchase_body");
  const subject = customSubject ? applyPlaceholders(customSubject, vars) : "Welcome to our 'Ohana";
  let text = customBody
    ? applyPlaceholders(customBody, vars)
    : `Hi${params.first_name ? ` ${params.first_name}` : ""},

Thanks for your purchase. You can view your membership and bookings in the app.

Download the app (open on your phone to add to home screen):
${installUrl}

Your Member ID: ${memberId}

To sign in for the first time, set your password here:
${setPasswordUrl}

After that you'll sign in with your email and password.${receiptBlock}

— Pono Fit Co.`;
  return sendMemberEmail(params.to, subject, text);
}

/** Invite member to download the app after first purchase or when given a membership. */
export async function sendAppDownloadInviteEmail(params: {
  to: string;
  first_name?: string | null;
  origin: string;
  /** Required so every invite includes Member ID and set-password link. */
  member_id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const origin = params.origin.replace(/\/$/, "");
  const installUrl = `${origin}/install`;
  const memberId = params.member_id.trim();
  const setPasswordUrl = `${origin}/set-password?member_id=${encodeURIComponent(memberId)}&email=${encodeURIComponent(params.to)}`;
  const vars = {
    first_name: params.first_name ? ` ${params.first_name}` : "",
    member_id: memberId,
    email: params.to,
    origin,
    install_url: installUrl,
    set_password_url: setPasswordUrl,
  };
  const customSubject = getEmailSetting("email_app_download_subject");
  const customBody = getEmailSetting("email_app_download_body");
  const subject = customSubject
    ? applyPlaceholders(customSubject, vars)
    : "new door-unlock system - switch over by 4/15!";
  const defaultText = `Aloha eeeverybody!

We are launching our new app for the gym, which we built ourselves!  We are pretty stoked on it, especially because it helps you track your macros and your workouts for free, and your data goes absolutely nowhere because it's OUR app!

Click the link below to register and install, or just register and read the waiver.  Kisi will still work, if that's what you prefer, but you must at least read and sign the liability waiver to get continued access.  Let us know if you have any questions!

${installUrl}

Your Member ID: ${memberId}

To set your app password (first-time sign-in):
${setPasswordUrl}

Me Ke Mahalo,

Bekah & Perry`;
  const text = customBody ? applyPlaceholders(customBody, vars) : defaultText;
  return sendMemberEmail(params.to, subject, text);
}

/** Send waiver signing link to a team member. */
export async function sendWaiverLinkEmail(params: {
  to: string;
  waiver_url: string;
  team_name: string;
  first_name?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const subject = `Sign your waiver — ${params.team_name}`;
  const text = `Hi${params.first_name ? ` ${params.first_name}` : ""},\n\nPlease sign the waiver for ${params.team_name} by clicking the link below (link expires in 30 days):\n\n${params.waiver_url}\n\n— Pono Fit Co.`;
  return sendMemberEmail(params.to, subject, text);
}

/** Send admin a copy when a waiver is signed. */
export async function sendWaiverSignedCopyToAdmin(params: {
  member_name: string;
  team_name: string;
  email: string;
  signed_at: string;
}): Promise<boolean> {
  const subject = `Waiver signed: ${params.member_name} — ${params.team_name}`;
  const text = `${params.member_name} (${params.email}) signed the waiver for ${params.team_name} at ${params.signed_at}.`;
  return sendStaffEmail(subject, text);
}

/** Send liability waiver link so member can sign before door (Kisi) access. */
/** Password reset link after "Forgot password" (token expires; see API route). */
export async function sendPasswordResetEmail(params: {
  to: string;
  first_name?: string | null;
  reset_url: string;
}): Promise<{ ok: boolean; error?: string }> {
  const subject = `Reset your ${BRAND.shortName} password`;
  const text = `Hi${params.first_name ? ` ${params.first_name}` : ""},

We received a request to reset your password for ${BRAND.name}.

Open this link to choose a new password (link expires in 24 hours):
${params.reset_url}

If you didn’t ask for this, you can ignore this email — your password won’t change.

— ${BRAND.name}`;
  return sendMemberEmail(params.to, subject, text);
}

/** Sent from Admin → Money owed → Send email reminder. Placeholders include {{pay_url}} (sign-in → Membership to update card). */
export async function sendMoneyOwedReminderEmail(params: {
  to: string;
  first_name: string | null;
  member_name: string;
  plan_name: string | null;
  amount_dollars: number;
  /** Absolute URL, e.g. https://gym.com/login?next=%2Fmember%2Fmembership */
  pay_url: string;
}): Promise<{ ok: boolean; error?: string }> {
  const amountFormatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(params.amount_dollars);
  const vars: Record<string, string> = {
    first_name: (params.first_name ?? "").trim(),
    member_name: params.member_name.trim(),
    plan_name: (params.plan_name ?? "").trim(),
    amount_formatted: amountFormatted,
    pay_url: params.pay_url.trim(),
  };
  const customSubject = getEmailSetting("email_money_owed_reminder_subject");
  const customBody = getEmailSetting("email_money_owed_reminder_body");
  const subject = customSubject
    ? applyPlaceholders(customSubject, vars)
    : "Membership payment reminder";
  const defaultBody = `Aloha {{first_name}},

Just a friendly reminder that your monthly-membership fee is due, if you'd like to keep using the gym.  Mahalo, and we hope to see you soon :)

Sign in to update your payment method or review your membership (auto-renew will retry once your card works):

{{pay_url}}

Me Ke Aloha,

Bekah & Perry`;
  const text = customBody ? applyPlaceholders(customBody, vars) : applyPlaceholders(defaultBody, vars);
  return sendMemberEmail(params.to, subject, text);
}

export async function sendLiabilityWaiverEmail(params: {
  to: string;
  first_name?: string | null;
  waiver_url: string;
}): Promise<{ ok: boolean; error?: string }> {
  const vars = {
    first_name: params.first_name ? ` ${params.first_name}` : "",
    waiver_url: params.waiver_url,
  };
  const customSubject = getEmailSetting("email_liability_waiver_subject");
  const customBody = getEmailSetting("email_liability_waiver_body");
  const subject = customSubject ? applyPlaceholders(customSubject, vars) : "Sign your liability waiver to get door access";
  const defaultText = `Hi${params.first_name ? ` ${params.first_name}` : ""},\n\nPlease sign the liability waiver to activate your door access. Open the link below (valid for 14 days):\n\n${params.waiver_url}\n\n— Pono Fit Co.`;
  const text = customBody ? applyPlaceholders(customBody, vars) : defaultText;
  return sendMemberEmail(params.to, subject, text);
}
