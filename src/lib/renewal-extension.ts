/**
 * Shared logic to extend a monthly subscription after a successful renewal charge
 * (cron) or admin write-off / manual retry success.
 */

import { randomUUID } from "crypto";
import {
  clearPaymentFailuresAfterSubscriptionRenewal,
  ensureSalesItemTotalCcFeeColumns,
  ensureSalesTypeColumn,
  ensureSubscriptionComplimentaryColumns,
  ensureSubscriptionRenewalDiscountPercentColumn,
  getDb,
} from "./db";
import { formatDateTimeInAppTz, todayInAppTz, formatDateForStorage } from "./app-timezone";
import { computeRenewalChargePrice } from "./renewal-pricing";
import { grantAccess as kisiGrantAccess } from "./kisi";
import { ensureWaiverBeforeKisi } from "./waiver";

type AppDb = ReturnType<typeof getDb>;

export type RenewalSubRow = {
  subscription_id: string;
  member_id: string;
  expiry_date: string;
  sub_price: string;
  quantity: number | string;
  promo_renewals_remaining: number | null;
  renewal_price_indefinite: number | null;
  /** Onboarding complimentary: renew without charge while 1; optional remaining count. */
  complimentary?: number | null;
  complimentary_renewals_remaining?: number | null;
  renewal_discount_percent?: number | null;
  plan_name: string;
  plan_price: string;
  length: string;
  unit: string;
};

export type RenewalMemberRow = {
  email: string | null;
  first_name: string | null;
};

function parseStoredYmdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!y || mo < 0 || d < 1) return null;
  return new Date(y, mo, d, 12, 0, 0, 0);
}

function addDuration(startDate: Date, length: string, unit: string): Date {
  const d = new Date(startDate);
  const n = Math.max(0, parseInt(length, 10) || 1);
  if (unit === "Day") d.setDate(d.getDate() + n);
  else if (unit === "Week") d.setDate(d.getDate() + n * 7);
  else if (unit === "Month") d.setMonth(d.getMonth() + n);
  else if (unit === "Year") d.setFullYear(d.getFullYear() + n);
  return d;
}

export type RenewalFinancials = {
  grandTotal: string;
  taxAmount: string;
  itemTotal: string;
  ccFee: string;
  /** 'renewal' for paid charge; 'complimentary' for write-off (still extends period). */
  saleType: "renewal" | "complimentary";
};

/**
 * Extends subscription by one plan period from the **subscription’s current period end**
 * (`sub.expiry_date`), **not** from “today”. That way late payers don’t get extra free days:
 * the new `expiry_date` and `members.exp_next_payment_date` are
 * `addPeriod(previousPeriodEnd)`, same as the renewal cron.
 *
 * We never fall back to anchoring from today — a missing/invalid `expiry_date` throws.
 */
export async function extendSubscriptionAfterRenewal(
  db: AppDb,
  tz: string,
  sub: RenewalSubRow,
  memberRow: RenewalMemberRow,
  financials: RenewalFinancials
): Promise<{ expiryStr: string; expiryDate: Date }> {
  const anchorDate = parseStoredYmdToLocalDate(sub.expiry_date);
  if (!anchorDate) {
    throw new Error(
      "Cannot renew: subscription expiry_date is missing or invalid. Expected YYYY-MM-DD period end to extend from."
    );
  }
  const expiryDate = addDuration(anchorDate, sub.length || "1", sub.unit || "Month");
  const expiryStr = formatDateForStorage(expiryDate, tz);
  const daysRemaining = Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  const sales_id = randomUUID().slice(0, 8);

  ensureSalesItemTotalCcFeeColumns(db);
  ensureSalesTypeColumn(db);
  ensureSubscriptionComplimentaryColumns(db);
  ensureSubscriptionRenewalDiscountPercentColumn(db);

  const useComplimentary = (sub.complimentary ?? 0) === 1;
  const pr = sub.promo_renewals_remaining;
  const indef = (sub.renewal_price_indefinite ?? 0) === 1;

  db.exec("BEGIN TRANSACTION");
  try {
    if (useComplimentary) {
      const rem = sub.complimentary_renewals_remaining;
      if (rem === null || rem === undefined) {
        db.prepare("UPDATE subscriptions SET expiry_date = ?, days_remaining = ? WHERE subscription_id = ?").run(
          expiryStr,
          String(daysRemaining),
          sub.subscription_id
        );
      } else if (rem > 1) {
        db.prepare(
          `UPDATE subscriptions SET expiry_date = ?, days_remaining = ?, complimentary_renewals_remaining = ? WHERE subscription_id = ?`
        ).run(expiryStr, String(daysRemaining), rem - 1, sub.subscription_id);
      } else {
        db.prepare(
          `UPDATE subscriptions SET expiry_date = ?, days_remaining = ?, complimentary = 0, complimentary_renewals_remaining = NULL,
           price = ?, promo_renewals_remaining = NULL, renewal_price_indefinite = 0 WHERE subscription_id = ?`
        ).run(
          expiryStr,
          String(daysRemaining),
          computeRenewalChargePrice(sub.plan_price, {
            sub_price: sub.sub_price,
            promo_renewals_remaining: null,
            renewal_price_indefinite: 0,
            renewal_discount_percent: sub.renewal_discount_percent ?? null,
          }),
          sub.subscription_id
        );
      }
    } else if (pr != null && pr > 0) {
      const next = pr - 1;
      if (next === 0) {
        db.prepare(
          `UPDATE subscriptions SET expiry_date = ?, days_remaining = ?, promo_renewals_remaining = NULL, renewal_price_indefinite = 0, price = ? WHERE subscription_id = ?`
        ).run(
          expiryStr,
          String(daysRemaining),
          computeRenewalChargePrice(sub.plan_price, {
            sub_price: sub.sub_price,
            promo_renewals_remaining: null,
            renewal_price_indefinite: 0,
            renewal_discount_percent: sub.renewal_discount_percent ?? null,
          }),
          sub.subscription_id
        );
      } else {
        db.prepare(`UPDATE subscriptions SET expiry_date = ?, days_remaining = ?, promo_renewals_remaining = ? WHERE subscription_id = ?`).run(
          expiryStr,
          String(daysRemaining),
          next,
          sub.subscription_id
        );
      }
    } else if (indef) {
      db.prepare("UPDATE subscriptions SET expiry_date = ?, days_remaining = ? WHERE subscription_id = ?").run(expiryStr, String(daysRemaining), sub.subscription_id);
    } else {
      db.prepare("UPDATE subscriptions SET expiry_date = ?, days_remaining = ? WHERE subscription_id = ?").run(expiryStr, String(daysRemaining), sub.subscription_id);
    }

    const date_time = formatDateTimeInAppTz(new Date(), undefined, tz);
    db.prepare(`
      INSERT INTO sales (sales_id, date_time, member_id, grand_total, tax_amount, item_total, cc_fee, email, status, sale_date, sale_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Paid', ?, ?)
    `).run(
      sales_id,
      date_time,
      sub.member_id,
      financials.grandTotal,
      financials.taxAmount,
      financials.itemTotal,
      financials.ccFee,
      memberRow.email ?? "",
      todayInAppTz(tz),
      financials.saleType
    );
    db.prepare("UPDATE members SET exp_next_payment_date = ? WHERE member_id = ?").run(expiryStr, sub.member_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const failureGroupKey =
    sub.subscription_id != null && String(sub.subscription_id).trim() !== ""
      ? String(sub.subscription_id).trim()
      : "";
  clearPaymentFailuresAfterSubscriptionRenewal(db, sub.member_id, failureGroupKey);

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const waiver = await ensureWaiverBeforeKisi(sub.member_id, {
    email: memberRow.email ?? null,
    first_name: memberRow.first_name ?? null,
  }, origin);
  if (waiver.shouldGrantKisi) {
    const kisiId = db.prepare("SELECT kisi_id FROM members WHERE member_id = ?").get(sub.member_id) as { kisi_id: string | null } | undefined;
    if (kisiId?.kisi_id) {
      try {
        await kisiGrantAccess(kisiId.kisi_id, expiryDate);
      } catch (e) {
        console.error("[renewal-extension] Kisi grant failed for member:", sub.member_id, e);
      }
    }
  }

  return { expiryStr, expiryDate };
}
