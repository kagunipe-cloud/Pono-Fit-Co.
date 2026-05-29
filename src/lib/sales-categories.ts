import type { getDb } from "./db";

type SqliteDb = ReturnType<typeof getDb>;

/** PT pack purchases recorded only on pt_credit_ledger (older checkouts or missing pt_bookings row). */
export function hasPtCreditLedgerPurchase(db: SqliteDb, salesId: string): boolean {
  try {
    return (
      db
        .prepare(
          `SELECT 1 FROM pt_credit_ledger
           WHERE reference_type = 'sale' AND reference_id = ? AND reason = 'purchase'
           LIMIT 1`
        )
        .get(salesId) != null
    );
  } catch {
    return false;
  }
}

/** Class pack purchases recorded only on class_credit_ledger. */
export function hasClassCreditLedgerPurchase(db: SqliteDb, salesId: string): boolean {
  try {
    return (
      db
        .prepare(
          `SELECT 1 FROM class_credit_ledger
           WHERE reference_type = 'sale' AND reference_id = ? AND reason = 'purchase'
           LIMIT 1`
        )
        .get(salesId) != null
    );
  } catch {
    return false;
  }
}

/** Keep newest row when legacy data has duplicate sales_id rows. */
export function dedupeSalesRowsBySalesId<T extends { sales_id?: unknown }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = String(row.sales_id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}
