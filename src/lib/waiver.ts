import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import { sendLiabilityWaiverEmail } from "@/lib/email";

const WAIVER_TOKEN_EXPIRY_DAYS = 14;

/**
 * If the member has not signed the liability waiver, set a magic-link token,
 * send the waiver email, and return { shouldGrantKisi: false }.
 * If they have already signed, return { shouldGrantKisi: true } so the caller can grant Kisi.
 */
export async function ensureWaiverBeforeKisi(
  member_id: string,
  member: { email: string | null; first_name?: string | null },
  origin: string
): Promise<{ shouldGrantKisi: boolean }> {
  const db = getDb();
  try {
    const row = db.prepare("SELECT waiver_signed_at FROM members WHERE member_id = ?").get(member_id) as
      | { waiver_signed_at: string | null }
      | undefined;
    if (row?.waiver_signed_at?.trim()) {
      return { shouldGrantKisi: true };
    }
    const token = randomBytes(32).toString("hex");
    const expires = new Date();
    expires.setDate(expires.getDate() + WAIVER_TOKEN_EXPIRY_DAYS);
    db.prepare(
      "UPDATE members SET waiver_token = ?, waiver_token_expires_at = ? WHERE member_id = ?"
    ).run(token, expires.toISOString(), member_id);
    const emailTo = member.email?.trim();
    if (emailTo) {
      const waiverUrl = `${origin.replace(/\/$/, "")}/sign-waiver?token=${encodeURIComponent(token)}`;
      const result = await sendLiabilityWaiverEmail({
        to: emailTo,
        first_name: member.first_name,
        waiver_url: waiverUrl,
      });
      if (!result.ok) console.error("[waiver] sendLiabilityWaiverEmail:", result.error);
    }
    return { shouldGrantKisi: false };
  } finally {
    db.close();
  }
}
