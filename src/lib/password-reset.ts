import { randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { getDb, ensureMembersPasswordColumn, ensureMembersPasswordResetColumns } from "@/lib/db";
import { sendPasswordResetEmail, isGmailApiConfigured } from "@/lib/email";

export const RESET_TOKEN_HOURS = 24;

function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return !!(host && user && pass);
}

/** Same check as forgot-password: SMTP or Gmail API. */
export function isPasswordResetEmailConfigured(): boolean {
  return isSmtpConfigured() || isGmailApiConfigured();
}

export function resolvePasswordResetOrigin(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  if (proto && host) return `${proto}://${host}`.replace(/\/$/, "");
  return request.nextUrl.origin.replace(/\/$/, "");
}

export type PasswordResetRow = {
  member_id: string;
  email: string | null;
  first_name: string | null;
  password_hash: string | null;
};

export type IssuePasswordResetResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_email" | "no_password" | "send_failed";
      message: string;
    };

/**
 * Store a new reset token and send the same email as the public forgot-password flow.
 * Caller must ensure email is configured (see {@link isPasswordResetEmailConfigured}).
 */
export async function issuePasswordResetTokenAndSend(
  request: NextRequest,
  row: PasswordResetRow
): Promise<IssuePasswordResetResult> {
  if (!(row.password_hash ?? "").trim()) {
    return { ok: false, reason: "no_password", message: "No app password on file for this member." };
  }
  const sendTo = row.email?.trim();
  if (!sendTo) {
    return { ok: false, reason: "no_email", message: "No email address on file." };
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date();
  expires.setHours(expires.getHours() + RESET_TOKEN_HOURS);

  const db = getDb();
  ensureMembersPasswordColumn(db);
  ensureMembersPasswordResetColumns(db);
  db.prepare(
    "UPDATE members SET password_reset_token = ?, password_reset_expires_at = ? WHERE member_id = ?"
  ).run(token, expires.toISOString(), row.member_id);
  db.close();

  const base = resolvePasswordResetOrigin(request);
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;

  const result = await sendPasswordResetEmail({
    to: sendTo,
    first_name: row.first_name,
    reset_url: resetUrl,
  });
  if (!result.ok) {
    console.error("[password-reset] send failed:", result.error);
    return {
      ok: false,
      reason: "send_failed",
      message: result.error ?? "Could not send email.",
    };
  }
  return { ok: true };
}
