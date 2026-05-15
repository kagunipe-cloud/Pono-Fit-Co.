import type { getDb } from "./db";
import { ensureGiftPassesTable } from "./db";
import { ensureSaleRetailLinesTable, ensureRetailProductsTable } from "./retail-products";
import { ensureDayPassCreditLedger } from "./day-pass-credits";

type Db = ReturnType<typeof getDb>;

export type SalePurchaseLine = { label: string };

/** Human-readable line items for checkout rows linked by `sales_id` (and member-scoped ledgers). */
export function getSalePurchaseLinesBySalesId(db: Db, memberId: string, salesIds: string[]): Map<string, SalePurchaseLine[]> {
  const map = new Map<string, SalePurchaseLine[]>();
  const ids = [...new Set(salesIds.map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return map;

  const add = (sid: string, label: string) => {
    const s = String(sid ?? "").trim();
    if (!s || !label.trim()) return;
    const arr = map.get(s) ?? [];
    arr.push({ label: label.trim() });
    map.set(s, arr);
  };

  const placeholders = ids.map(() => "?").join(",");
  const withMember = [memberId, ...ids];

  const salesWithPtBookings = new Set<string>();

  try {
    const rows = db
      .prepare(
        `SELECT s.sales_id, p.plan_name, s.quantity
         FROM subscriptions s
         LEFT JOIN membership_plans p ON p.product_id = s.product_id
         WHERE s.member_id = ? AND s.sales_id IN (${placeholders})`
      )
      .all(...withMember) as { sales_id: string; plan_name: string | null; quantity: number | string | null }[];
    for (const r of rows) {
      const q = Math.max(1, Math.floor(Number(r.quantity) || 1));
      const name = String(r.plan_name ?? "Membership").trim() || "Membership";
      add(String(r.sales_id), q > 1 ? `${q}× ${name}` : name);
    }
  } catch {
    /* subscriptions / membership_plans */
  }

  try {
    const rows = db
      .prepare(
        `SELECT b.sales_id, ps.session_name, b.quantity
         FROM pt_bookings b
         LEFT JOIN pt_sessions ps ON ps.product_id = b.product_id
         WHERE b.member_id = ? AND b.sales_id IN (${placeholders})`
      )
      .all(...withMember) as { sales_id: string; session_name: string | null; quantity: number | string | null }[];
    for (const r of rows) {
      const sid = String(r.sales_id);
      salesWithPtBookings.add(sid);
      const q = Math.max(1, Math.floor(Number(r.quantity) || 1));
      const name = String(r.session_name ?? "PT session").trim() || "PT session";
      add(sid, q > 1 ? `${q}× ${name}` : name);
    }
  } catch {
    /* pt_bookings */
  }

  try {
    const rows = db
      .prepare(
        `SELECT b.sales_id, c.class_name, b.quantity
         FROM class_bookings b
         LEFT JOIN classes c ON c.product_id = b.product_id
         WHERE b.member_id = ? AND b.sales_id IN (${placeholders})`
      )
      .all(...withMember) as { sales_id: string; class_name: string | null; quantity: number | string | null }[];
    for (const r of rows) {
      const q = Math.max(1, Math.floor(Number(r.quantity) || 1));
      const name = String(r.class_name ?? "Class").trim() || "Class";
      add(String(r.sales_id), q > 1 ? `${q}× ${name}` : name);
    }
  } catch {
    /* class_bookings */
  }

  try {
    ensureSaleRetailLinesTable(db);
    ensureRetailProductsTable(db);
    const rows = db
      .prepare(
        `SELECT l.sales_id, l.quantity,
            CASE WHEN g.id IS NOT NULL THEN g.display_name || ' — ' || p.name ELSE p.name END AS name
         FROM sale_retail_lines l
         JOIN retail_products p ON p.id = l.retail_product_id
         LEFT JOIN retail_product_groups g ON g.id = p.group_id
         WHERE l.sales_id IN (${placeholders})
         ORDER BY name COLLATE NOCASE`
      )
      .all(...ids) as { sales_id: string; quantity: number | null; name: string | null }[];
    for (const r of rows) {
      const q = Math.max(1, Math.floor(Number(r.quantity) || 1));
      const name = String(r.name ?? "Retail item").trim() || "Retail item";
      add(String(r.sales_id), q > 1 ? `${q}× ${name}` : name);
    }
  } catch {
    /* retail */
  }

  try {
    ensureDayPassCreditLedger(db);
    const rows = db
      .prepare(
        `SELECT reference_id AS sales_id, SUM(amount) AS n
         FROM day_pass_credit_ledger
         WHERE member_id = ? AND reference_type = 'sale' AND reference_id IN (${placeholders})
         GROUP BY reference_id`
      )
      .all(...withMember) as { sales_id: string; n: number | string | null }[];
    for (const r of rows) {
      const n = Math.max(1, Math.floor(Number(r.n) || 0));
      if (n <= 0) continue;
      add(String(r.sales_id), `${n} day pass day${n !== 1 ? "s" : ""} (credits)`);
    }
  } catch {
    /* day pass ledger */
  }

  try {
    const rows = db
      .prepare(
        `SELECT reference_id AS sales_id, SUM(amount) AS n
         FROM class_credit_ledger
         WHERE member_id = ? AND reference_type = 'sale' AND reference_id IN (${placeholders})
         GROUP BY reference_id`
      )
      .all(...withMember) as { sales_id: string; n: number | string | null }[];
    for (const r of rows) {
      const n = Math.max(1, Math.floor(Number(r.n) || 0));
      if (n <= 0) continue;
      add(String(r.sales_id), `${n} class credit${n !== 1 ? "s" : ""}`);
    }
  } catch {
    /* class credits */
  }

  try {
    const rows = db
      .prepare(
        `SELECT reference_id AS sales_id, duration_minutes, SUM(amount) AS n
         FROM pt_credit_ledger
         WHERE member_id = ? AND reference_type = 'sale' AND reference_id IN (${placeholders})
         GROUP BY reference_id, duration_minutes`
      )
      .all(...withMember) as { sales_id: string; duration_minutes: number | null; n: number | string | null }[];
    for (const r of rows) {
      const sid = String(r.sales_id);
      if (salesWithPtBookings.has(sid)) continue;
      const n = Math.max(1, Math.floor(Number(r.n) || 0));
      if (n <= 0) continue;
      const dm = Math.max(1, Math.floor(Number(r.duration_minutes) || 60));
      add(sid, `${n}× ${dm}-min PT credit${n !== 1 ? "s" : ""}`);
    }
  } catch {
    /* pt credits */
  }

  try {
    ensureGiftPassesTable(db);
    const rows = db
      .prepare(
        `SELECT g.sales_id, p.plan_name, g.recipient_email
         FROM gift_passes g
         JOIN membership_plans p ON p.id = g.membership_plan_id
         WHERE g.purchaser_member_id = ? AND g.sales_id IN (${placeholders})`
      )
      .all(...withMember) as { sales_id: string; plan_name: string | null; recipient_email: string | null }[];
    for (const r of rows) {
      const plan = String(r.plan_name ?? "Membership").trim() || "Membership";
      const em = String(r.recipient_email ?? "").trim();
      add(String(r.sales_id), em ? `Gift: ${plan} → ${em}` : `Gift: ${plan}`);
    }
  } catch {
    /* gift passes */
  }

  return map;
}
