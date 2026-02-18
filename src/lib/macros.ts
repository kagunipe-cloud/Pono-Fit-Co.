/**
 * Macros / foods table for tracking calories, macros, and optional micronutrients.
 * - foods: main table (name, calories, protein_g, etc.).
 * - nutrients: lookup of nutrient id (USDA id) -> name, unit (for display and "which to track").
 * - food_nutrients: (food_id, nutrient_id, amount) for all nutrients per food (macro + micro).
 * - member_tracked_nutrients: (member_id, nutrient_id) so each member can choose which micros to show.
 *
 * Expected columns for CSV/JSON imports (flexible naming):
 * - name / description / food_name
 * - calories / energy_kcal, protein_g / protein, fat_g / fat, carbs_g / carbs, fiber_g / fiber
 * - serving_description / serving_size, source
 *
 * Optional density_g_per_ml: for volume-marketed foods (e.g. creamer in mL). When set,
 * 1 mL = density_g_per_ml grams so we can normalize to weight for sync and convert back
 * to volume for display. Null = not set (we keep serving in volume and use per-serving nutrients).
 */

export function ensureFoodsTable(db: ReturnType<typeof import("./db").getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      calories REAL,
      protein_g REAL,
      fat_g REAL,
      carbs_g REAL,
      fiber_g REAL,
      serving_description TEXT,
      source TEXT DEFAULT 'manual',
      fdc_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_foods_name ON foods(name);
    CREATE INDEX IF NOT EXISTS idx_foods_source ON foods(source);

    CREATE TABLE IF NOT EXISTS nutrients (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      unit_name TEXT
    );

    CREATE TABLE IF NOT EXISTS food_nutrients (
      food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
      nutrient_id INTEGER NOT NULL REFERENCES nutrients(id),
      amount REAL NOT NULL,
      PRIMARY KEY (food_id, nutrient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_food_nutrients_food ON food_nutrients(food_id);
    CREATE INDEX IF NOT EXISTS idx_food_nutrients_nutrient ON food_nutrients(nutrient_id);

    CREATE TABLE IF NOT EXISTS member_tracked_nutrients (
      member_id TEXT NOT NULL,
      nutrient_id INTEGER NOT NULL REFERENCES nutrients(id),
      PRIMARY KEY (member_id, nutrient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_member_tracked_nutrients_member ON member_tracked_nutrients(member_id);
  `);

  const cols = db.prepare("PRAGMA table_info(foods)").all() as { name: string }[];
  for (const col of ["fiber_g", "serving_description", "source", "fdc_id", "serving_size", "serving_size_unit", "serving_size_grams", "barcode", "data_quality", "nutrients_per_100g", "density_g_per_ml"]) {
    if (cols.every((c) => c.name !== col)) {
      try {
        const type = col === "source" || col === "serving_description" || col === "serving_size_unit" || col === "barcode" || col === "data_quality" ? "TEXT" : col === "nutrients_per_100g" ? "INTEGER" : "REAL";
        const def = col === "source" ? "DEFAULT 'manual'" : col === "nutrients_per_100g" ? "DEFAULT 0" : "";
        if (col === "fdc_id") db.prepare("ALTER TABLE foods ADD COLUMN fdc_id INTEGER").run();
        else if (col === "serving_size_unit") db.prepare("ALTER TABLE foods ADD COLUMN serving_size_unit TEXT").run();
        else if (col === "serving_size") db.prepare("ALTER TABLE foods ADD COLUMN serving_size REAL").run();
        else if (col === "serving_size_grams") db.prepare("ALTER TABLE foods ADD COLUMN serving_size_grams REAL").run();
        else if (col === "nutrients_per_100g") db.prepare("ALTER TABLE foods ADD COLUMN nutrients_per_100g INTEGER DEFAULT 0").run();
        else if (col === "density_g_per_ml") db.prepare("ALTER TABLE foods ADD COLUMN density_g_per_ml REAL").run();
        else db.prepare(`ALTER TABLE foods ADD COLUMN ${col} ${type} ${def}`).run();
      } catch {
        /* ignore */
      }
    }
  }
  try {
    db.prepare("CREATE INDEX IF NOT EXISTS idx_foods_fdc_id ON foods(fdc_id)").run();
  } catch {
    /* column may not exist on very old DBs */
  }
  try {
    db.prepare("CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode)").run();
  } catch {
    /* barcode column may not exist on very old DBs */
  }

  seedCommonNutrients(db);
}

/** USDA FDC nutrient IDs we support for display and "track which". */
export const COMMON_NUTRIENT_IDS: { id: number; name: string; unit_name: string }[] = [
  { id: 1008, name: "Energy", unit_name: "kcal" },
  { id: 1003, name: "Protein", unit_name: "g" },
  { id: 1004, name: "Total lipid (fat)", unit_name: "g" },
  { id: 1005, name: "Carbohydrate, by difference", unit_name: "g" },
  { id: 1079, name: "Fiber, total dietary", unit_name: "g" },
  { id: 1087, name: "Calcium, Ca", unit_name: "mg" },
  { id: 1086, name: "Iron, Fe", unit_name: "mg" },
  { id: 1093, name: "Sodium, Na", unit_name: "mg" },
  { id: 1095, name: "Zinc, Zn", unit_name: "mg" },
  { id: 1106, name: "Vitamin A, RAE", unit_name: "µg" },
  { id: 1162, name: "Vitamin C, total ascorbic acid", unit_name: "mg" },
  { id: 1114, name: "Vitamin D (D2 + D3), International Units", unit_name: "IU" },
  { id: 1258, name: "Vitamin D (D2 + D3)", unit_name: "µg" },
  { id: 1109, name: "Vitamin E (alpha-tocopherol)", unit_name: "mg" },
  { id: 1185, name: "Vitamin K (phylloquinone)", unit_name: "µg" },
  { id: 1165, name: "Thiamin", unit_name: "mg" },
  { id: 1166, name: "Riboflavin", unit_name: "mg" },
  { id: 1167, name: "Niacin", unit_name: "mg" },
  { id: 1175, name: "Vitamin B-6", unit_name: "mg" },
  { id: 1177, name: "Folate, total", unit_name: "µg" },
  { id: 1178, name: "Vitamin B-12", unit_name: "µg" },
  { id: 1091, name: "Potassium, K", unit_name: "mg" },
  { id: 1098, name: "Phosphorus, P", unit_name: "mg" },
  { id: 1100, name: "Magnesium, Mg", unit_name: "mg" },
];

function seedCommonNutrients(db: ReturnType<typeof import("./db").getDb>) {
  const insert = db.prepare("INSERT OR IGNORE INTO nutrients (id, name, unit_name) VALUES (?, ?, ?)");
  for (const n of COMMON_NUTRIENT_IDS) {
    insert.run(n.id, n.name, n.unit_name);
  }
}
