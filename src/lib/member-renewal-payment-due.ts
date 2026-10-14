import {
  type getDb,
  ensureMembersAutoRenewColumn,
  ensurePaymentFailuresTable,
  ensureSubscriptionPauseStartedColumn,
} from "./db";

type AppDb = ReturnType<typeof getDb>;

export type MemberRenewalPaymentDue = {
  subscription_id: string | null;
  plan_name: string | null;
  amount_cents: number | null;
};

/**
 * Open failed auto-renewal for member self-serve Pay now — not stale rows from cancelled subs
 * or members who opted out of auto-renew.
 */
export function getMemberRenewalPaymentDue(db: AppDb, memberId: string): MemberRenewalPaymentDue | null {
  ensurePaymentFailuresTable(db);
  ensureMembersAutoRenewColumn(db);
  ensureSubscriptionPauseStartedColumn(db);

  const row = db
    .prepare(
      `SELECT f.subscription_id, f.plan_name, f.amount_cents
       FROM payment_failures f
       INNER JOIN members m ON m.member_id = f.member_id
       INNER JOIN subscriptions s ON s.member_id = f.member_id
         AND TRIM(COALESCE(f.subscription_id, '')) = TRIM(COALESCE(s.subscription_id, ''))
       INNER JOIN membership_plans p ON p.product_id = s.product_id
       WHERE f.member_id = ?
         AND (f.dismissed_at IS NULL OR TRIM(COALESCE(f.dismissed_at, '')) = '')
         AND m.auto_renew = 1
         AND LOWER(TRIM(COALESCE(s.status, ''))) = 'active'
         AND LOWER(TRIM(COALESCE(p.unit, ''))) = 'month'
         AND TRIM(COALESCE(s.subscription_pause_started, '')) = ''
       ORDER BY f.id DESC
       LIMIT 1`
    )
    .get(memberId) as MemberRenewalPaymentDue | undefined;

  return row ?? null;
}
