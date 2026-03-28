import type { getDb } from "./db";

/** Cart row from DB including optional staff overrides. */
export type CartItemForPricing = {
  product_type: string;
  product_id: number;
  quantity: number;
  unit_price_override?: string | null;
};

function parsePrice(p: string | null | undefined): number {
  if (p == null || p === "") return 0;
  const n = parseFloat(String(p).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** Catalog unit price (before staff override). */
export function getCatalogUnitPriceString(db: ReturnType<typeof getDb>, it: CartItemForPricing): string {
  let price = "0";
  if (it.product_type === "membership_plan") {
    const row = db.prepare("SELECT price FROM membership_plans WHERE id = ?").get(it.product_id) as { price: string } | undefined;
    price = row?.price ?? "0";
  } else if (it.product_type === "pt_session") {
    const row = db.prepare("SELECT price FROM pt_sessions WHERE id = ?").get(it.product_id) as { price: string } | undefined;
    price = row?.price ?? "0";
  } else if (it.product_type === "class") {
    const row = db.prepare("SELECT price FROM classes WHERE id = ?").get(it.product_id) as { price: string } | undefined;
    price = row?.price ?? "0";
  } else if (it.product_type === "class_pack") {
    const row = db.prepare("SELECT price FROM class_pack_products WHERE id = ?").get(it.product_id) as { price: string } | undefined;
    price = row?.price ?? "0";
  } else if (it.product_type === "class_occurrence") {
    const occ = db.prepare(`
      SELECT COALESCE(c.price, r.price, '0') AS price
      FROM class_occurrences o
      LEFT JOIN classes c ON c.id = o.class_id
      LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
      WHERE o.id = ?
    `).get(it.product_id) as { price: string } | undefined;
    price = occ?.price ?? "0";
  } else if (it.product_type === "pt_pack") {
    const row = db.prepare("SELECT price FROM pt_pack_products WHERE id = ?").get(it.product_id) as { price: string } | undefined;
    price = row?.price ?? "0";
  }
  return price;
}

/** Effective unit price string for checkout (staff override or catalog). */
export function getEffectiveUnitPriceString(db: ReturnType<typeof getDb>, it: CartItemForPricing): string {
  const raw = (it.unit_price_override ?? "").trim();
  if (raw) {
    const n = parseFloat(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isNaN(n) && n >= 0) return n.toFixed(2);
  }
  return getCatalogUnitPriceString(db, it);
}

export function getEffectiveUnitPriceNumber(db: ReturnType<typeof getDb>, it: CartItemForPricing): number {
  return parsePrice(getEffectiveUnitPriceString(db, it));
}

/** Normalize user/staff input to a decimal string or null (clear override). */
export function normalizeUnitPriceOverrideInput(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n) || n < 0) return null;
  return n.toFixed(2);
}
