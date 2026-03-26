import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import { getDb, getAppTimezone, ensureMembersStripeColumn, ensureMembersAutoRenewColumn, ensureSubscriptionsSalesIdColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { normalizeDateToYMD, formatDateForStorage } from "@/lib/app-timezone";

export const dynamic = "force-dynamic";

type Row = Record<string, string | undefined>;

type PlanRow = { id: number; product_id: string; plan_name: string | null; price: string; length: string; unit: string };

type MemberRow = {
  id: number;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  join_date: string | null;
  exp_next_payment_date: string | null;
  phone: string | null;
};

function normalizeHeaderKey(k: string): string {
  return k.replace(/^\ufeff/, "").trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeRowKeys(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[normalizeHeaderKey(k)] = v;
  }
  return out;
}

function parseAutoRenew(v: string | undefined): number {
  if (!v?.trim()) return 0;
  const s = v.trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return 1;
  return 0;
}

function parsePrice(p: string | undefined): string | null {
  if (p == null || String(p).trim() === "") return null;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n)) return null;
  return String(n);
}

function daysRemainingFromExpiry(expiryYmd: string): number {
  const exp = new Date(expiryYmd + "T12:00:00Z").getTime();
  return Math.max(0, Math.ceil((exp - Date.now()) / (24 * 60 * 60 * 1000)));
}

/** Inverse of addDuration in checkout: period ending at expiryYmd starts at returned YYYY-MM-DD. */
function subtractPeriodFromExpiryYmd(expiryYmd: string, length: string, unit: string): string {
  const [y, m, d] = expiryYmd.split("-").map(Number);
  if (!y || !m || !d) return expiryYmd;
  const date = new Date(Date.UTC(y, m - 1, d));
  const n = Math.max(1, parseInt(length || "1", 10) || 1);
  if (unit === "Day") date.setUTCDate(date.getUTCDate() - n);
  else if (unit === "Week") date.setUTCDate(date.getUTCDate() - n * 7);
  else if (unit === "Month") date.setUTCMonth(date.getUTCMonth() - n);
  else if (unit === "Year") date.setUTCFullYear(date.getUTCFullYear() - n);
  else date.setUTCMonth(date.getUTCMonth() - n);
  return date.toISOString().slice(0, 10);
}

/**
 * POST — onboarding CSV: members + optional Active subscription (admin only).
 * Two modes:
 * - **Minimal:** email, auto_renew, stripe_customer_id, membership_plan_name (matches plan_name in DB).
 *   Member must already exist (e.g. Glofox import). Subscription dates use exp_next_payment_date on the member
 *   unless you override with subscription_expiry_date / exp_next_payment_date in the row.
 * - **Full:** membership_product_id + subscription_expiry_date (and optional other columns) as before.
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let csv = "";
  try {
    const body = await request.json();
    csv = typeof body.csv === "string" ? body.csv : "";
  } catch {
    return NextResponse.json({ error: "Body must be JSON with a 'csv' string." }, { status: 400 });
  }

  if (!csv.trim()) {
    return NextResponse.json({ error: "csv is required" }, { status: 400 });
  }

  let rows: Row[];
  try {
    rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Row[];
  } catch (err) {
    console.error("[import-onboarding] parse error", err);
    return NextResponse.json({ error: "Invalid CSV" }, { status: 400 });
  }

  const db = getDb();
  ensureMembersStripeColumn(db);
  ensureMembersAutoRenewColumn(db);
  ensureSubscriptionsSalesIdColumn(db);
  const tz = getAppTimezone(db);

  const getByEmail = db.prepare(
    `SELECT id, member_id, first_name, last_name, email, join_date, exp_next_payment_date, phone
     FROM members WHERE LOWER(TRIM(email)) = ?`
  );
  const updateMember = db.prepare(
    `UPDATE members SET first_name = ?, last_name = ?, join_date = ?, exp_next_payment_date = ?, phone = ?,
     stripe_customer_id = COALESCE(?, stripe_customer_id), auto_renew = ?
     WHERE member_id = ?`
  );
  const insertMember = db.prepare(
    `INSERT INTO members (member_id, first_name, last_name, email, role, join_date, exp_next_payment_date, phone, stripe_customer_id, auto_renew)
     VALUES (?, ?, ?, ?, 'Member', ?, ?, ?, ?, ?)`
  );

  const getPlanByProductId = db.prepare(
    "SELECT id, product_id, plan_name, price, length, unit FROM membership_plans WHERE TRIM(product_id) = TRIM(?)"
  );
  const getPlansByName = db.prepare(
    `SELECT id, product_id, plan_name, price, length, unit FROM membership_plans
     WHERE plan_name IS NOT NULL AND TRIM(plan_name) != '' AND LOWER(TRIM(plan_name)) = LOWER(TRIM(?))`
  );
  const getActiveSub = db.prepare(
    "SELECT subscription_id FROM subscriptions WHERE member_id = ? AND TRIM(product_id) = TRIM(?) AND status = 'Active' LIMIT 1"
  );
  const insertSub = db.prepare(`
    INSERT INTO subscriptions (subscription_id, member_id, product_id, status, start_date, expiry_date, days_remaining, price, sales_id, quantity)
    VALUES (?, ?, ?, 'Active', ?, ?, ?, ?, NULL, ?)
  `);
  const updateSub = db.prepare(`
    UPDATE subscriptions SET start_date = ?, expiry_date = ?, days_remaining = ?, price = ?, quantity = ?
    WHERE subscription_id = ?
  `);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let subscriptionsUpserted = 0;
  const errors: { row: number; email: string; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = normalizeRowKeys(rows[i]);
    const rawEmail = (raw.email ?? "").trim();
    const emailLower = rawEmail.toLowerCase();
    if (!emailLower) {
      skipped++;
      continue;
    }

    const firstNameIn = (raw.first_name ?? "").trim() || null;
    const lastNameIn = (raw.last_name ?? "").trim() || null;
    const phoneIn = (raw.phone ?? "").trim() || null;
    const joinDateIn = normalizeDateToYMD(raw.join_date ?? "") ?? null;
    const stripeCustomerId = (raw.stripe_customer_id ?? "").trim() || null;
    const autoRenew = parseAutoRenew(raw.auto_renew);
    const expNextIn = normalizeDateToYMD(raw.exp_next_payment_date ?? "") ?? null;

    const productId = (raw.membership_product_id ?? "").trim();
    const planNameIn = (raw.membership_plan_name ?? raw.membership_plan ?? raw.plan_name ?? "").trim();
    const subStartRaw = raw.subscription_start_date ?? "";
    const subExpiryRaw = raw.subscription_expiry_date ?? "";

    if (planNameIn && productId) {
      errors.push({
        row: i + 2,
        email: rawEmail,
        message: "Use either membership_plan_name or membership_product_id, not both.",
      });
      continue;
    }

    const wantsSubFull = Boolean(productId || subExpiryRaw.trim() || subStartRaw.trim());
    const wantsSubByName = Boolean(planNameIn && !productId);

    if (wantsSubFull && wantsSubByName) {
      errors.push({
        row: i + 2,
        email: rawEmail,
        message: "Remove membership_plan_name when using full subscription columns (product_id / subscription dates).",
      });
      continue;
    }

    if (wantsSubFull) {
      if (!productId) {
        errors.push({ row: i + 2, email: rawEmail, message: "membership_product_id is required when subscription dates are set." });
        continue;
      }
      if (!subExpiryRaw.trim()) {
        errors.push({ row: i + 2, email: rawEmail, message: "subscription_expiry_date is required when membership_product_id is set." });
        continue;
      }
    }

    const existing = getByEmail.get(emailLower) as MemberRow | undefined;

    if (wantsSubByName && !existing) {
      errors.push({
        row: i + 2,
        email: rawEmail,
        message: "Member not found. Import members first (Glofox CSV) so email, name, and exp_next_payment_date exist, then run this row again.",
      });
      continue;
    }

    let plan: PlanRow | undefined;
    let expiryYmd: string | null = null;
    let startYmd: string | null = null;
    let qtyStr = "1";
    let priceStored = "0";
    let daysRem = 0;

    if (wantsSubFull) {
      plan = getPlanByProductId.get(productId) as PlanRow | undefined;
      if (!plan) {
        errors.push({
          row: i + 2,
          email: rawEmail,
          message: `No membership plan with product_id "${productId}". Copy product_id from Membership plans in the app.`,
        });
        continue;
      }
      expiryYmd = normalizeDateToYMD(subExpiryRaw);
      if (!expiryYmd) {
        errors.push({ row: i + 2, email: rawEmail, message: "Invalid subscription_expiry_date." });
        continue;
      }
      startYmd = normalizeDateToYMD(subStartRaw);
      if (!startYmd) {
        startYmd = joinDateIn ?? formatDateForStorage(new Date(), tz);
      }
      qtyStr = String(Math.max(1, parseInt(String(raw.subscription_quantity ?? "1"), 10) || 1));
      const priceParsed = parsePrice(raw.subscription_price);
      priceStored = priceParsed ?? String(plan.price ?? "0");
      daysRem = daysRemainingFromExpiry(expiryYmd);
    } else if (wantsSubByName) {
      const matches = getPlansByName.all(planNameIn) as PlanRow[];
      if (matches.length === 0) {
        errors.push({
          row: i + 2,
          email: rawEmail,
          message: `No membership plan named "${planNameIn}". Use the exact plan name from Membership plans in the app.`,
        });
        continue;
      }
      if (matches.length > 1) {
        errors.push({
          row: i + 2,
          email: rawEmail,
          message: `Multiple plans named "${planNameIn}". Rename plans uniquely or use membership_product_id in full import mode.`,
        });
        continue;
      }
      plan = matches[0];
      expiryYmd =
        normalizeDateToYMD(subExpiryRaw) ||
        expNextIn ||
        normalizeDateToYMD(existing?.exp_next_payment_date ?? "") ||
        null;
      if (!expiryYmd) {
        errors.push({
          row: i + 2,
          email: rawEmail,
          message:
            "No renewal/expiry date: set exp_next_payment_date on the member (Glofox import) or add subscription_expiry_date / exp_next_payment_date to this row.",
        });
        continue;
      }
      startYmd = normalizeDateToYMD(subStartRaw);
      if (!startYmd) {
        startYmd = subtractPeriodFromExpiryYmd(expiryYmd, plan.length || "1", plan.unit || "Month");
      }
      qtyStr = String(Math.max(1, parseInt(String(raw.subscription_quantity ?? "1"), 10) || 1));
      const priceParsed = parsePrice(raw.subscription_price);
      priceStored = priceParsed ?? String(plan.price ?? "0");
      daysRem = daysRemainingFromExpiry(expiryYmd);
    }

    const firstName = firstNameIn ?? existing?.first_name ?? null;
    const lastName = lastNameIn ?? existing?.last_name ?? null;
    const phone = phoneIn ?? existing?.phone ?? null;
    const joinDate = joinDateIn ?? normalizeDateToYMD(existing?.join_date ?? "") ?? null;

    const shouldWriteSub = Boolean(plan && expiryYmd && startYmd && (wantsSubFull || wantsSubByName));
    const expForMember =
      expNextIn ??
      (shouldWriteSub ? expiryYmd : null) ??
      normalizeDateToYMD(existing?.exp_next_payment_date ?? "") ??
      null;

    try {
      db.exec("BEGIN TRANSACTION");
      let memberId: string;
      let didCreate = false;
      let didUpdate = false;
      let didSub = false;

      if (existing) {
        memberId = existing.member_id;
        updateMember.run(
          firstName,
          lastName,
          joinDate,
          expForMember,
          phone,
          stripeCustomerId,
          autoRenew,
          memberId
        );
        didUpdate = true;
      } else {
        memberId = randomUUID().slice(0, 8);
        insertMember.run(
          memberId,
          firstName,
          lastName,
          rawEmail || emailLower,
          joinDate,
          expNextIn ?? (shouldWriteSub ? expiryYmd : null) ?? null,
          phone,
          stripeCustomerId,
          autoRenew
        );
        didCreate = true;
      }

      if (shouldWriteSub && plan && expiryYmd && startYmd) {
        const existingSub = getActiveSub.get(memberId, plan.product_id) as { subscription_id: string } | undefined;
        if (existingSub) {
          updateSub.run(startYmd, expiryYmd, String(daysRem), priceStored, qtyStr, existingSub.subscription_id);
        } else {
          const subId = randomUUID().slice(0, 8);
          insertSub.run(subId, memberId, plan.product_id, startYmd, expiryYmd, String(daysRem), priceStored, qtyStr);
        }
        didSub = true;
      }

      db.exec("COMMIT");
      if (didCreate) created++;
      if (didUpdate) updated++;
      if (didSub) subscriptionsUpserted++;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      errors.push({ row: i + 2, email: rawEmail, message: String(err) });
    }
  }

  db.close();

  return NextResponse.json({
    created,
    updated,
    skipped,
    subscriptionsUpserted,
    total: rows.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
