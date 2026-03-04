/**
 * Persistent cache for AI-calculated macros. Reduces Gemini + Serper spend by reusing
 * previous results. Used for exact-match on Calculate and fuzzy suggest-as-you-type.
 */

const CACHE_MAX = 10_000; // Storage is cheap; more cache = fewer API calls

export function ensureAiMacrosCacheTable(db: ReturnType<typeof import("./db").getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_macros_cache (
      food_key TEXT PRIMARY KEY,
      calories INTEGER NOT NULL,
      protein_g REAL NOT NULL,
      fat_g REAL NOT NULL,
      carbs_g REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_macros_cache_key ON ai_macros_cache(food_key);
  `);
}

function normalizeKey(food: string): string {
  return food
    .replace(/\s+(macros?|nutrition\s*facts?|calories?)\s*$/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function getCachedMacros(
  db: ReturnType<typeof import("./db").getDb>,
  food: string,
  portionValue: number,
  portionUnit: string
): { calories: number; protein_g: number; fat_g: number; carbs_g: number } | null {
  ensureAiMacrosCacheTable(db);
  const u = portionUnit.toLowerCase().trim();
  const unit = u === "servings" || u === "serving" || u === "" ? "serving" : u;
  const key = `${normalizeKey(food)}|${portionValue}|${unit}`;
  const row = db.prepare(
    "SELECT calories, protein_g, fat_g, carbs_g FROM ai_macros_cache WHERE food_key = ?"
  ).get(key) as { calories: number; protein_g: number; fat_g: number; carbs_g: number } | undefined;
  return row ?? null;
}

export function setCachedMacros(
  db: ReturnType<typeof import("./db").getDb>,
  food: string,
  portionValue: number,
  portionUnit: string,
  result: { calories: number; protein_g: number; fat_g: number; carbs_g: number }
) {
  ensureAiMacrosCacheTable(db);
  const u = portionUnit.toLowerCase().trim();
  const unit = u === "servings" || u === "serving" || u === "" ? "serving" : u;
  const key = `${normalizeKey(food)}|${portionValue}|${unit}`;
  const count = db.prepare("SELECT COUNT(*) as n FROM ai_macros_cache").get() as { n: number };
  if (count.n >= CACHE_MAX) {
    db.prepare(
      "DELETE FROM ai_macros_cache WHERE food_key = (SELECT food_key FROM ai_macros_cache ORDER BY created_at ASC LIMIT 1)"
    ).run();
  }
  db.prepare(
    "INSERT OR REPLACE INTO ai_macros_cache (food_key, calories, protein_g, fat_g, carbs_g) VALUES (?, ?, ?, ?, ?)"
  ).run(key, result.calories, result.protein_g, result.fat_g, result.carbs_g);
}

export function searchCachedMacros(
  db: ReturnType<typeof import("./db").getDb>,
  query: string,
  limit = 5
): Array<{ food_key: string; calories: number; protein_g: number; fat_g: number; carbs_g: number }> {
  ensureAiMacrosCacheTable(db);
  const q = normalizeKey(query).trim();
  if (!q || q.length < 2) return [];
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`);
  const prefixPattern = `${escaped}%`;
  const wordPattern = `% ${escaped}%`; // "rice" matches "brown rice"
  // Prefix first (most relevant), then word-boundary (" rice" in "brown rice"). Avoids "chi" → "sandwich"
  return db
    .prepare(
      `SELECT food_key, calories, protein_g, fat_g, carbs_g FROM ai_macros_cache
       WHERE food_key LIKE ? ESCAPE '\\' OR food_key LIKE ? ESCAPE '\\'
       ORDER BY CASE WHEN food_key LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, LENGTH(food_key)
       LIMIT ?`
    )
    .all(prefixPattern, wordPattern, prefixPattern, limit) as Array<{
      food_key: string;
      calories: number;
      protein_g: number;
      fat_g: number;
      carbs_g: number;
    }>;
}
