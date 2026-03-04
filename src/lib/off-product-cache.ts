/**
 * Persistent cache for Open Food Facts barcode lookups. Reduces API calls when
 * users re-scan the same products. Product data rarely changes.
 */

const CACHE_MAX = 10_000;

export type CachedOFFFood = {
  name: string;
  barcode: string;
  calories: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  fiber_g: number | null;
  serving_size: number | null;
  serving_size_unit: string | null;
  serving_description: string | null;
  source: "openfoodfacts";
};

export function ensureOffProductCacheTable(db: ReturnType<typeof import("./db").getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS off_product_cache (
      barcode TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_off_product_cache_barcode ON off_product_cache(barcode);
  `);
}

function normalizeBarcode(barcode: string): string {
  return String(barcode).trim().replace(/\D/g, "") || "";
}

export function getCachedOffProduct(
  db: ReturnType<typeof import("./db").getDb>,
  barcode: string
): CachedOFFFood | null {
  ensureOffProductCacheTable(db);
  const key = normalizeBarcode(barcode);
  if (!key) return null;
  const row = db.prepare("SELECT data_json FROM off_product_cache WHERE barcode = ?").get(key) as { data_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data_json) as CachedOFFFood;
  } catch {
    return null;
  }
}

export function setCachedOffProduct(
  db: ReturnType<typeof import("./db").getDb>,
  barcode: string,
  data: CachedOFFFood
) {
  ensureOffProductCacheTable(db);
  const key = normalizeBarcode(barcode);
  if (!key) return;
  const count = db.prepare("SELECT COUNT(*) as n FROM off_product_cache").get() as { n: number };
  if (count.n >= CACHE_MAX) {
    db.prepare(
      "DELETE FROM off_product_cache WHERE barcode = (SELECT barcode FROM off_product_cache ORDER BY created_at ASC LIMIT 1)"
    ).run();
  }
  db.prepare("INSERT OR REPLACE INTO off_product_cache (barcode, data_json) VALUES (?, ?)").run(key, JSON.stringify(data));
}
