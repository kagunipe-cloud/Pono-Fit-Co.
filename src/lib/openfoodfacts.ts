/**
 * Open Food Facts API client.
 * - Product by barcode: GET /api/v2/product/{barcode}
 * - Search: GET /cgi/search.pl (v1 style, returns JSON with count and products)
 * See https://openfoodfacts.github.io/openfoodfacts-server/api/
 * Rate limits: 100 req/min product, 10 req/min search. Use User-Agent.
 * OFF nutriments are per 100g. We convert to per-serving at normalize time so the DB stores per-serving.
 */

import { unitToGrams, unitToMl, getUnitType } from "@/lib/food-units";

const OFF_BASE = "https://world.openfoodfacts.org";
const USER_AGENT = process.env.OPENFOODFACTS_USER_AGENT ?? "TheFoxSays/1.0 (nutrition-app)";

function defaultHeaders(): HeadersInit {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
}

export type OFFProduct = {
  code: string;
  product?: {
    product_name?: string;
    product_name_en?: string;
    brands?: string;
    quantity?: string;
    serving_quantity?: number;
    serving_quantity_unit?: string;
    serving_size?: string;
    nutriments?: {
      "energy-kcal_100g"?: number;
      "energy_100g"?: number;
      "energy-kcal_serving"?: number;
      "energy_serving"?: number;
      proteins_100g?: number;
      "proteins_serving"?: number;
      fat_100g?: number;
      "fat_serving"?: number;
      carbohydrates_100g?: number;
      "carbohydrates_serving"?: number;
      fiber_100g?: number;
      "fiber_serving"?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  status?: number;
  status_verbose?: string;
};

/** Our normalized food shape (matches foods table). */
export type NormalizedOFFFood = {
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

function pickNum(obj: Record<string, unknown> | undefined, ...keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    const n = parseFloat(String(v));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/** Parse OFF nutriments (per 100g or per serving) into our schema. Prefer per-serving when present. */
export function normalizeOFFProduct(product: OFFProduct): NormalizedOFFFood | null {
  const code = product.code ?? "";
  const p = product.product;
  if (!p) return null;

  const nameRaw = p.product_name_en ?? p.product_name ?? "";
  const name = (typeof nameRaw === "string" ? nameRaw : "").trim() || "Unknown product";
  const brands = (p.brands ?? "").trim();
  const displayName = brands ? `${name} (${brands})` : name;

  const nut = p.nutriments ?? {};
  // OFF provides per-100g (and sometimes per-serving). We store per-serving for consistency.
  let calories: number | null = pickNum(nut as Record<string, unknown>, "energy-kcal_100g", "energy_100g");
  if (calories == null && typeof (nut as Record<string, unknown>)["energy_100g"] === "number") {
    const kj = (nut as Record<string, unknown>)["energy_100g"] as number;
    if (kj > 100) calories = Math.round(kj / 4.184); // assume kJ
    else calories = kj;
  }
  let protein_g = pickNum(nut as Record<string, unknown>, "proteins_100g");
  let fat_g = pickNum(nut as Record<string, unknown>, "fat_100g");
  let carbs_g = pickNum(nut as Record<string, unknown>, "carbohydrates_100g");
  let fiber_g = pickNum(nut as Record<string, unknown>, "fiber_100g");

  // Serving: OFF has serving_quantity + serving_quantity_unit, or serving_size string like "30 g" or "15 ml"
  let serving_size: number | null = null;
  let serving_size_unit: string | null = null;
  const sq = p.serving_quantity;
  const squ = p.serving_quantity_unit;
  if (typeof sq === "number" && sq > 0) {
    serving_size = sq;
    serving_size_unit = typeof squ === "string" && squ.trim() ? squ.trim() : "g";
  }
  const ss = p.serving_size;
  if ((serving_size == null || serving_size_unit == null) && typeof ss === "string" && ss.trim()) {
    const match = ss.trim().match(/^([\d.]+)\s*(\w+)$/i);
    if (match) {
      serving_size = parseFloat(match[1]);
      serving_size_unit = match[2];
    }
  }
  if (serving_size == null && (protein_g != null || fat_g != null || carbs_g != null)) {
    serving_size = 100;
    serving_size_unit = "g";
  }
  // Store standard unit (OFF sometimes uses "MLT" for milliliters)
  if (serving_size_unit && /^mlt$/i.test(serving_size_unit)) serving_size_unit = "ml";

  const servingGrams =
    serving_size != null && serving_size_unit != null
      ? unitToGrams(serving_size, serving_size_unit)
      : null;
  const servingMl =
    serving_size != null && serving_size_unit != null
      ? unitToMl(serving_size, serving_size_unit)
      : null;
  const isVolumeServing = getUnitType(serving_size_unit) === "volume";

  // For volume servings (e.g. 11 ml creamer): use OFF's per-serving nutrients when present so we don't wrongly scale per-100g by volume. Without density we cannot convert volume→weight for per-100g scaling.
  if (isVolumeServing && servingMl != null && servingMl > 0) {
    const calServing = pickNum(nut as Record<string, unknown>, "energy-kcal_serving", "energy_serving");
    if (calServing != null) calories = calServing;
    const pServing = pickNum(nut as Record<string, unknown>, "proteins_serving");
    if (pServing != null) protein_g = pServing;
    const fServing = pickNum(nut as Record<string, unknown>, "fat_serving");
    if (fServing != null) fat_g = fServing;
    const cServing = pickNum(nut as Record<string, unknown>, "carbohydrates_serving");
    if (cServing != null) carbs_g = cServing;
    const fibServing = pickNum(nut as Record<string, unknown>, "fiber_serving");
    if (fibServing != null) fiber_g = fibServing;
  }

  // Convert per-100g to per-serving when we have a weight-based serving (e.g. 37 g bar)
  if (servingGrams != null && servingGrams > 0 && servingGrams !== 100) {
    const factor = servingGrams / 100;
    if (calories != null) calories = Math.round(calories * factor * 10) / 10;
    if (protein_g != null) protein_g = Math.round(protein_g * factor * 100) / 100;
    if (fat_g != null) fat_g = Math.round(fat_g * factor * 100) / 100;
    if (carbs_g != null) carbs_g = Math.round(carbs_g * factor * 100) / 100;
    if (fiber_g != null) fiber_g = Math.round(fiber_g * factor * 100) / 100;
  }

  const serving_description =
    serving_size != null && serving_size_unit
      ? `${serving_size} ${serving_size_unit}`
      : null;

  // Exclude products with no real name so search results don't show "Unknown product"
  const displayLower = displayName.toLowerCase();
  if (
    displayLower === "unknown product" ||
    displayLower === "unknown products" ||
    displayLower.startsWith("unknown product ") ||
    displayLower.startsWith("unknown products ")
  ) {
    return null;
  }

  return {
    name: displayName,
    barcode: code,
    calories,
    protein_g,
    fat_g,
    carbs_g,
    fiber_g,
    serving_size,
    serving_size_unit,
    serving_description,
    source: "openfoodfacts",
  };
}

/** Fetch product by barcode. Returns raw OFF response. */
export async function fetchOFFProduct(barcode: string): Promise<OFFProduct | null> {
  const code = String(barcode).trim().replace(/\D/g, "");
  if (!code) return null;
  const url = `${OFF_BASE}/api/v2/product/${code}`;
  const res = await fetch(url, { headers: defaultHeaders() });
  const data = await res.json().catch(() => ({}));
  if (data.status !== 1 || !data.product) return null;
  return data as OFFProduct;
}

/** Search OFF (v1 cgi). Returns array of product codes; then use fetchOFFProduct for each if needed. */
export async function searchOFF(query: string, pageSize = 20): Promise<{ count: number; products: OFFProduct[] }> {
  const q = encodeURIComponent(String(query).trim());
  if (!q) return { count: 0, products: [] };
  const url = `${OFF_BASE}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=${Math.min(50, pageSize)}`;
  const res = await fetch(url, { headers: defaultHeaders() });
  const data = await res.json().catch(() => ({}));
  const count = typeof data.count === "number" ? data.count : 0;
  const list = Array.isArray(data.products) ? data.products : [];
  const products: OFFProduct[] = list
    .filter((p: unknown) => p != null && typeof p === "object")
    .map((p: Record<string, unknown>) => {
      const productObj = p.product as { code?: string } | undefined;
      const code = (p.code ?? productObj?.code ?? "") as string;
      const product = (p.product ?? p) as OFFProduct["product"];
      return { code: code || (product?.code as string), product } as OFFProduct;
    })
    .filter((p: OFFProduct) => p.code);
  return { count, products };
}
