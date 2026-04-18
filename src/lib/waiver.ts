import { getDb, ensureMembersDoorAccessWaiverExemptColumn } from "@/lib/db";

/**
 * If the member has not signed the liability waiver, return { shouldGrantKisi: false } — unless they were
 * marked `door_access_waiver_exempt` by a deliberate admin migration (legacy imports). New signups keep 0.
 */
export async function ensureWaiverBeforeKisi(
  member_id: string,
  _member: { email: string | null; first_name?: string | null },
  _origin: string
): Promise<{ shouldGrantKisi: boolean }> {
  const db = getDb();
  try {
    ensureMembersDoorAccessWaiverExemptColumn(db);
    const row = db.prepare("SELECT waiver_signed_at, door_access_waiver_exempt FROM members WHERE member_id = ?").get(member_id) as
      | { waiver_signed_at: string | null; door_access_waiver_exempt: number | null }
      | undefined;
    if (row?.waiver_signed_at?.trim()) return { shouldGrantKisi: true };
    if (Number(row?.door_access_waiver_exempt) === 1) return { shouldGrantKisi: true };
    return { shouldGrantKisi: false };
  } finally {
    db.close();
  }
}
