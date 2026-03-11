import { getDb } from "@/lib/db";

/**
 * If the member has not signed the liability waiver, return { shouldGrantKisi: false }.
 * Kisi is granted when they sign the waiver in-app. If already signed, return { shouldGrantKisi: true }.
 */
export async function ensureWaiverBeforeKisi(
  member_id: string,
  _member: { email: string | null; first_name?: string | null },
  _origin: string
): Promise<{ shouldGrantKisi: boolean }> {
  const db = getDb();
  try {
    const row = db.prepare("SELECT waiver_signed_at FROM members WHERE member_id = ?").get(member_id) as
      | { waiver_signed_at: string | null }
      | undefined;
    return { shouldGrantKisi: !!(row?.waiver_signed_at?.trim()) };
  } finally {
    db.close();
  }
}
