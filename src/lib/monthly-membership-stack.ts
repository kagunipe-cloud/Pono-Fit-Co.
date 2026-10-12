import { WEEKLY_GOALS_BOARD_ACCESS_LEVEL, type getDb } from "./db";
import { MEMBERSHIP_PLAN_JOIN_SQL } from "./mrr";

type AppDb = ReturnType<typeof getDb>;

export type MembershipPlanRow = {
  unit?: string | null;
  access_level?: string | null;
  category?: string | null;
};

/** Door-access style monthly membership (not goal-board add-on, not day/week pass). */
export function isDoorMonthlyMembershipPlan(plan: MembershipPlanRow | null | undefined): boolean {
  if (!plan) return false;
  const unit = String(plan.unit ?? "").trim().toLowerCase();
  if (unit !== "month") return false;
  const level = String(plan.access_level ?? "").trim();
  if (level === WEEKLY_GOALS_BOARD_ACCESS_LEVEL) return false;
  const cat = String(plan.category ?? "").trim().toLowerCase();
  if (cat === "passes") return false;
  return true;
}

export function countActiveDoorMonthlySubscriptions(db: AppDb, memberId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM subscriptions s
       JOIN membership_plans p ON ${MEMBERSHIP_PLAN_JOIN_SQL}
       WHERE s.member_id = ?
         AND LOWER(TRIM(COALESCE(s.status, ''))) = 'active'
         AND LOWER(TRIM(COALESCE(p.unit, ''))) = 'month'
         AND TRIM(COALESCE(p.access_level, '')) != ?
         AND LOWER(TRIM(COALESCE(p.category, ''))) != 'passes'`
    )
    .get(memberId, WEEKLY_GOALS_BOARD_ACCESS_LEVEL) as { c: number } | undefined;
  return Math.max(0, Number(row?.c ?? 0));
}

function cartHasDoorMonthlyMembership(db: AppDb, cartId: number, excludeCartItemId?: number): boolean {
  const rows = db
    .prepare(
      `SELECT ci.id, ci.product_id
       FROM cart_items ci
       WHERE ci.cart_id = ? AND ci.product_type = 'membership_plan'
         AND (ci.gift_recipient_email IS NULL OR TRIM(ci.gift_recipient_email) = '')`
    )
    .all(cartId) as { id: number; product_id: number }[];
  for (const row of rows) {
    if (excludeCartItemId != null && row.id === excludeCartItemId) continue;
    const plan = db
      .prepare("SELECT unit, access_level, category FROM membership_plans WHERE id = ?")
      .get(row.product_id) as MembershipPlanRow | undefined;
    if (isDoorMonthlyMembershipPlan(plan)) return true;
  }
  return false;
}

export const MONTHLY_MEMBERSHIP_STACK_ERROR =
  "This member already has an active monthly membership. Cancel the extra subscription or use Pay Now on the member home page if renewal failed — don't add another monthly membership. Day passes and weekly plans are still OK.";

export const MEMBER_EXISTING_MONTHLY_MESSAGE =
  "You already have a monthly membership with us. If you need to pay your bill, click below.";

export const EXISTING_MONTHLY_MEMBERSHIP_CODE = "existing_monthly_membership";

export function isMemberSelfCartAction(
  sessionMemberId: string | null,
  memberId: string,
  isStaff: boolean,
  isAdmin: boolean
): boolean {
  return !!sessionMemberId && sessionMemberId === memberId && !isStaff && !isAdmin;
}

/** Gym admins may stack multiple door monthly memberships on a member profile; everyone else is blocked. */
export function enforceDoorMonthlyMembershipStack(isAdmin: boolean): boolean {
  return !isAdmin;
}

/** HTTP body for blocked monthly-on-monthly; member UI gets Pay now affordance via `code`. */
export function monthlyMembershipStackHttpBody(forMemberUi: boolean): Record<string, unknown> {
  if (!forMemberUi) {
    return { error: MONTHLY_MEMBERSHIP_STACK_ERROR };
  }
  return {
    error: MEMBER_EXISTING_MONTHLY_MESSAGE,
    code: EXISTING_MONTHLY_MEMBERSHIP_CODE,
    show_pay_renewal: true,
  };
}

/**
 * Block adding another door monthly membership when one is already active or already in the cart.
 * Gifts (recipient email) are allowed.
 */
export function doorMonthlyMembershipStackError(
  db: AppDb,
  memberId: string,
  plan: MembershipPlanRow | null | undefined,
  opts?: { cartId?: number; excludeCartItemId?: number }
): string | null {
  if (!isDoorMonthlyMembershipPlan(plan)) return null;
  if (countActiveDoorMonthlySubscriptions(db, memberId) >= 1) {
    return MONTHLY_MEMBERSHIP_STACK_ERROR;
  }
  if (opts?.cartId != null && cartHasDoorMonthlyMembership(db, opts.cartId, opts.excludeCartItemId)) {
    return MONTHLY_MEMBERSHIP_STACK_ERROR;
  }
  return null;
}

export function assertNoDoorMonthlyStackInCart(db: AppDb, memberId: string, cartId: number): string | null {
  const active = countActiveDoorMonthlySubscriptions(db, memberId);
  if (active < 1) return null;
  if (!cartHasDoorMonthlyMembership(db, cartId)) return null;
  return MONTHLY_MEMBERSHIP_STACK_ERROR;
}
