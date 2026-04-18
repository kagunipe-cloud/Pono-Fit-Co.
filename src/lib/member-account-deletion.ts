import { getDb, ensureMembersDoorAccessWaiverExemptColumn } from "./db";
import { ensurePTSlotTables } from "./pt-slots";
import { randomBytes } from "crypto";
import { hashPassword } from "./password";
import { deleteKisiUserBestEffort } from "./kisi";

type Db = ReturnType<typeof getDb>;

/** True if the member has any subscription, sale, or booking row — must anonymize instead of removing the row. */
export function memberHasRetentionHistory(db: Db, memberId: string): boolean {
  const mid = memberId.trim();
  if (db.prepare("SELECT 1 FROM subscriptions WHERE member_id = ? LIMIT 1").get(mid)) return true;
  if (db.prepare("SELECT 1 FROM sales WHERE member_id = ? LIMIT 1").get(mid)) return true;
  if (db.prepare("SELECT 1 FROM class_bookings WHERE member_id = ? LIMIT 1").get(mid)) return true;
  try {
    if (db.prepare("SELECT 1 FROM occurrence_bookings WHERE member_id = ? LIMIT 1").get(mid)) return true;
  } catch {
    /* table may not exist */
  }
  let hasPt = db.prepare("SELECT 1 FROM pt_bookings WHERE member_id = ? LIMIT 1").get(mid) != null;
  try {
    ensurePTSlotTables(db);
    if (!hasPt) hasPt = db.prepare("SELECT 1 FROM pt_slot_bookings WHERE member_id = ? LIMIT 1").get(mid) != null;
    if (!hasPt) hasPt = db.prepare("SELECT 1 FROM pt_trainer_specific_bookings WHERE member_id = ? LIMIT 1").get(mid) != null;
    if (!hasPt) hasPt = db.prepare("SELECT 1 FROM pt_open_bookings WHERE member_id = ? LIMIT 1").get(mid) != null;
  } catch {
    /* ignore */
  }
  return hasPt;
}

/**
 * Remove member row entirely (no subscriptions/sales/bookings).
 * Caller must verify password and native app elsewhere.
 */
export function hardDeleteMemberRow(db: Db, internalId: number): void {
  db.prepare("DELETE FROM members WHERE id = ?").run(internalId);
}

const ANON_FIRST = "Former";
const ANON_LAST = "Member";

/**
 * Anonymize PII and mark account closed. Keeps member_id and historical FK rows.
 */
export async function softDeleteAnonymizeMember(db: Db, internalId: number, memberId: string): Promise<void> {
  ensureMembersDoorAccessWaiverExemptColumn(db);
  const kisiRow = db.prepare("SELECT kisi_id FROM members WHERE id = ?").get(internalId) as { kisi_id: string | null } | undefined;
  const kisiId = kisiRow?.kisi_id?.trim();
  if (kisiId) {
    try {
      await deleteKisiUserBestEffort(kisiId);
    } catch (e) {
      console.error("[account deletion] Kisi cleanup failed:", e);
    }
  }

  const junkEmail = `removed-${memberId}-${randomBytes(6).toString("hex")}@account-closed.invalid`;
  const deadHash = hashPassword(randomBytes(32).toString("hex"));
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE members SET
      account_deleted_at = ?,
      email = ?,
      password_hash = ?,
      first_name = ?, last_name = ?, preferred_name = NULL,
      phone = NULL, pronouns = NULL, birthday = NULL, mailing_address = NULL,
      emergency_contact_name = NULL, emergency_contact_phone = NULL, emergency_info = NULL,
      spirit_animal = NULL,
      kisi_id = NULL, kisi_group_id = NULL,
      stripe_customer_id = NULL,
      insurance_program = NULL,
      waiver_signed_at = NULL, privacy_terms_accepted_at = NULL,
      door_access_waiver_exempt = 0,
      auto_renew = 0,
      exp_next_payment_date = NULL,
      pass_activation_day = NULL
     WHERE id = ?`
  ).run(now, junkEmail, deadHash, ANON_FIRST, ANON_LAST, internalId);
}
