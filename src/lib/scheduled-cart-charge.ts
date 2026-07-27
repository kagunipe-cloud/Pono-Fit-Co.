import type { getDb } from "./db";
import { ensureCartTables } from "./cart";
import { normalizeDateToYMD, todayInAppTz } from "./app-timezone";

export type CartItemSnapshot = {
  product_type: string;
  product_id: number;
  quantity: number;
  slot_json?: string | null;
  unit_price_override?: string | null;
  price_override_months?: number | null;
  price_override_indefinite?: number | null;
  gift_recipient_email?: string | null;
  membership_start_date?: string | null;
};

export type ScheduledCartChargeRow = {
  id: number;
  member_id: string;
  charge_on_ymd: string;
  status: string;
  cart_snapshot_json: string;
  promo_code: string | null;
  monthly_recurring: number;
  created_at: string;
  completed_at: string | null;
  last_attempt_ymd: string | null;
  last_error: string | null;
  payment_intent_id: string | null;
};

export function ensureScheduledCartChargesTable(db: ReturnType<typeof getDb>) {
  ensureCartTables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_cart_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      charge_on_ymd TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      cart_snapshot_json TEXT NOT NULL,
      promo_code TEXT,
      monthly_recurring INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      last_attempt_ymd TEXT,
      last_error TEXT,
      payment_intent_id TEXT
    )
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_scheduled_cart_charges_due ON scheduled_cart_charges (status, charge_on_ymd)");
  } catch {
    /* ignore */
  }
}

export function parseCartSnapshot(json: string): CartItemSnapshot[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as CartItemSnapshot[];
}

export function snapshotCartItems(
  items: {
    product_type: string;
    product_id: number;
    quantity: number;
    slot_json?: string | null;
    unit_price_override?: string | null;
    price_override_months?: number | null;
    price_override_indefinite?: number | null;
    gift_recipient_email?: string | null;
    membership_start_date?: string | null;
  }[]
): CartItemSnapshot[] {
  return items.map((it) => ({
    product_type: it.product_type,
    product_id: it.product_id,
    quantity: it.quantity,
    slot_json: it.slot_json ?? null,
    unit_price_override: it.unit_price_override ?? null,
    price_override_months: it.price_override_months ?? null,
    price_override_indefinite: it.price_override_indefinite ?? null,
    gift_recipient_email: it.gift_recipient_email ?? null,
    membership_start_date: it.membership_start_date ?? null,
  }));
}

export function normalizeChargeOnYmd(raw: unknown, tz: string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const norm = normalizeDateToYMD(String(raw).trim());
  if (!norm) return null;
  const today = todayInAppTz(tz);
  if (norm < today) return null;
  return norm;
}

/** Suggested charge date: latest membership start on cart lines, or null. */
export function suggestedChargeOnFromSnapshot(items: CartItemSnapshot[], tz: string): string | null {
  let max: string | null = null;
  for (const it of items) {
    const d = (it.membership_start_date ?? "").trim();
    if (!d) continue;
    const norm = normalizeDateToYMD(d);
    if (!norm) continue;
    if (norm < todayInAppTz(tz)) continue;
    if (!max || norm > max) max = norm;
  }
  return max;
}

export function getActiveScheduledChargeForMember(
  db: ReturnType<typeof getDb>,
  memberId: string
): ScheduledCartChargeRow | undefined {
  ensureScheduledCartChargesTable(db);
  return db
    .prepare(
      `SELECT * FROM scheduled_cart_charges
       WHERE member_id = ? AND status IN ('pending', 'awaiting_card', 'failed')
       ORDER BY id DESC LIMIT 1`
    )
    .get(memberId) as ScheduledCartChargeRow | undefined;
}

export function clearMemberCartItems(db: ReturnType<typeof getDb>, memberId: string) {
  ensureCartTables(db);
  const cart = db.prepare("SELECT id FROM cart WHERE member_id = ?").get(memberId) as { id: number } | undefined;
  if (!cart) return;
  db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(cart.id);
  db.prepare("UPDATE cart SET promo_code = NULL WHERE id = ?").run(cart.id);
}

export function restoreCartFromSnapshot(db: ReturnType<typeof getDb>, memberId: string, snapshot: CartItemSnapshot[], promoCode: string | null) {
  ensureCartTables(db);
  let cart = db.prepare("SELECT id FROM cart WHERE member_id = ?").get(memberId) as { id: number } | undefined;
  if (!cart) {
    db.prepare("INSERT INTO cart (member_id) VALUES (?)").run(memberId);
    cart = db.prepare("SELECT id FROM cart WHERE member_id = ?").get(memberId) as { id: number };
  }
  db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(cart.id);
  const ins = db.prepare(`
    INSERT INTO cart_items (
      cart_id, product_type, product_id, quantity, slot_json,
      unit_price_override, price_override_months, price_override_indefinite,
      gift_recipient_email, membership_start_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const it of snapshot) {
    ins.run(
      cart.id,
      it.product_type,
      it.product_id,
      Math.max(1, it.quantity),
      it.slot_json ?? null,
      it.unit_price_override ?? null,
      it.price_override_months ?? null,
      it.price_override_indefinite ?? null,
      it.gift_recipient_email ?? null,
      it.membership_start_date ?? null
    );
  }
  db.prepare("UPDATE cart SET promo_code = ? WHERE id = ?").run(promoCode?.trim() || null, cart.id);
}
