import { getDb } from "./db";

/** Whether sessionMemberId may load exercise stats (frequency, favorites) for targetMemberId. */
export function canAccessMemberExerciseStats(
  db: ReturnType<typeof getDb>,
  sessionMemberId: string,
  targetMemberId: string
): boolean {
  if (sessionMemberId === targetMemberId) return true;
  const row = db.prepare("SELECT role FROM members WHERE member_id = ?").get(sessionMemberId) as { role: string | null } | undefined;
  const role = row?.role ?? "Member";
  if (role === "Admin") return true;
  if (role === "Trainer" || role === "Admin") {
    const link = db
      .prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?")
      .get(sessionMemberId, targetMemberId);
    return !!link;
  }
  return false;
}
