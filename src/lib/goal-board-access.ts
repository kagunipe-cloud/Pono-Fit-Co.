import type { getDb } from "./db";
import { WEEKLY_GOALS_BOARD_ACCESS_LEVEL, ensureWeeklyGoalsBoardPlan } from "./db";
import { todayInAppTz } from "./app-timezone";

type Db = ReturnType<typeof getDb>;

export function ensureGoalBoardAccess(db: Db): void {
  ensureWeeklyGoalsBoardPlan(db);
}

export function memberHasGoalBoardAccess(db: Db, memberId: string, tz: string): boolean {
  ensureGoalBoardAccess(db);
  const today = todayInAppTz(tz);
  const row = db
    .prepare(
      `SELECT 1
       FROM subscriptions s
       JOIN membership_plans p ON p.product_id = s.product_id
       WHERE s.member_id = ?
         AND s.status = 'Active'
         AND s.expiry_date >= ?
         AND p.access_level = ?
       LIMIT 1`
    )
    .get(memberId, today, WEEKLY_GOALS_BOARD_ACCESS_LEVEL) as { 1?: number } | undefined;
  return !!row;
}

export function goalBoardEligibleMemberIds(db: Db, tz: string): Set<string> {
  ensureGoalBoardAccess(db);
  const today = todayInAppTz(tz);
  const rows = db
    .prepare(
      `SELECT DISTINCT s.member_id
       FROM subscriptions s
       JOIN membership_plans p ON p.product_id = s.product_id
       WHERE s.status = 'Active'
         AND s.expiry_date >= ?
         AND p.access_level = ?`
    )
    .all(today, WEEKLY_GOALS_BOARD_ACCESS_LEVEL) as { member_id: string | null }[];
  return new Set(rows.map((r) => String(r.member_id ?? "").trim()).filter(Boolean));
}

export function getGoalBoardPlanId(db: Db): number | null {
  ensureGoalBoardAccess(db);
  const row = db
    .prepare("SELECT id FROM membership_plans WHERE access_level = ? ORDER BY id LIMIT 1")
    .get(WEEKLY_GOALS_BOARD_ACCESS_LEVEL) as { id: number } | undefined;
  return row?.id ?? null;
}
