import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

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

/** Send an email to staff (STAFF_EMAIL). No-op if SMTP not configured. */
export async function sendStaffEmail(subject: string, text: string): Promise<boolean> {
  const staffEmail = process.env.STAFF_EMAIL;
  if (!staffEmail) return false;
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

/** Send an email to a member. No-op if SMTP not configured. Returns { ok, error? }. */
export async function sendMemberEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!to?.trim()) return { ok: false, error: "No recipient" };
  const trans = getTransporter();
  if (!trans) return { ok: false, error: "SMTP not configured" };
  try {
    await trans.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@localhost",
      to: to.trim(),
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
}): Promise<{ ok: boolean; error?: string }> {
  const installUrl = `${params.origin.replace(/\/$/, "")}/install`;
  const subject = "Get the Pono Fit Co. app";
  const text = `Hi${params.first_name ? ` ${params.first_name}` : ""},\n\nDownload our app to view your membership, book classes, and more:\n\n${installUrl}\n\nOpen this link on your phone and follow the steps to add the app to your home screen.\n\n— Pono Fit Co.`;
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
