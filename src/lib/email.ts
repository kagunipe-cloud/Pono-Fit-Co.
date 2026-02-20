import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

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
  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  return data.access_token ?? null;
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

/** Send membership expiring in 2 days reminder. Card on file: remind them they're set if card is valid. No card: payment due on expiry date. */
export async function sendMembershipExpiryReminder(params: {
  to: string;
  first_name?: string | null;
  expiry_date: string;
  has_card_on_file: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const subject = "Your membership is expiring soon";
  const closing = "\n\nMahalo Nui Loa,\n\nB & P";
  const text = params.has_card_on_file
    ? `Aloha,\n\nBekah & Perry with Pono Fit Co. here! We're just emailing to let you know that your membership expires on ${params.expiry_date}. You have a card on file—as long as it's still valid, you're all set and we'll charge it automatically. If your card has changed or expired, please update it in the app before ${params.expiry_date} so we can process your renewal.${closing}`
    : `Aloha,\n\nBekah & Perry with Pono Fit Co. here! We're just emailing to let you know that your membership expires on ${params.expiry_date}. Payment is due by then to continue your access. You can renew in the app or at the front desk.${closing}`;
  return sendMemberEmail(params.to, subject, text);
}

/** Post-purchase receipt / confirmation to member. */
export async function sendPostPurchaseEmail(params: {
  to: string;
  member_id: string;
  first_name?: string | null;
  origin: string;
}): Promise<{ ok: boolean; error?: string }> {
  const subject = "Thanks for your purchase";
  const text = `Hi${params.first_name ? ` ${params.first_name}` : ""},\n\nThanks for your purchase. You can view your membership and bookings in the app: ${params.origin}.\n\n— Pono Fit Co.`;
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
  const subject = "Get the Pono Fit Co. app";
  const text = `Hi${params.first_name ? ` ${params.first_name}` : ""},

Download our app to view your membership, book classes, and more:

${installUrl}

Open this link on your phone and follow the steps to add the app to your home screen.

Your Member ID: ${memberId}

To sign in for the first time, set your password here:
${setPasswordUrl}

After that you'll sign in with your email and password.

— Pono Fit Co.`;
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
