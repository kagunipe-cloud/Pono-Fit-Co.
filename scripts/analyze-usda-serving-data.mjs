/**
 * Fetches ~500 USDA FoodData Central foods and analyzes serving-size data using
 * FULL DETAIL (GET /food/{fdcId}) so we see serving data for ALL dataTypes (search
 * often omits it for Survey/SR Legacy/Foundation).
 *
 * Run from project root with FDC_API_KEY in env or in .env.local:
 *   node scripts/analyze-usda-serving-data.mjs
 *
 * Output: summary by dataType (total, with serving, unit=mg, impossible mg) and JSON dump.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch (_) {}
}

const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const TARGET_FOODS = 500;
const PAGE_SIZE = 200;
const MAX_PLAUSIBLE_CAL_PER_100G = 900;
const DELAY_MS = 220; // ~4.5 req/s, 500 foods in ~2 min, under 1000/hr

const SEARCH_TERMS = [
  "cereal", "chicken", "milk", "bread", "apple", "rice", "cheese", "yogurt", "pasta",
  "beef", "egg", "fish", "banana", "oatmeal", "salad", "soup", "pizza", "cookie",
  "chocolate", "nuts", "beans", "turkey", "pork", "corn", "potato", "onion", "tomato",
  "broccoli", "carrot", "lettuce", "oil", "butter", "sugar", "honey", "flour",
  "ice cream", "crackers", "granola", "protein bar", "juice", "soda",
];

function getCalories(food) {
  const nutrients = food.foodNutrients || [];
  const energy = nutrients.find(
    (n) => (n.nutrientId ?? n.nutrient?.id) === 1008
  );
  const val = energy?.value ?? energy?.amount;
  return typeof val === "number" && !Number.isNaN(val) ? val : null;
}

function normUnit(u) {
  return String(u ?? "").toLowerCase().trim().replace(/s$/, "");
}

function isImpossibleMg(servingSize, servingSizeUnit, calories) {
  const u = normUnit(servingSizeUnit);
  if (u !== "mg" && u !== "milligram") return false;
  if (
    servingSize == null ||
    servingSize <= 0 ||
    calories == null ||
    calories <= 0
  )
    return false;
  const calPer100g = (calories * 100_000) / servingSize;
  return calPer100g > MAX_PLAUSIBLE_CAL_PER_100G;
}

async function search(apiKey, query, pageNumber = 1) {
  const url = `${FDC_BASE}/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=${PAGE_SIZE}&pageNumber=${pageNumber}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data;
}

async function fetchFood(apiKey, fdcId) {
  const url = `${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data;
}

async function main() {
  loadEnv();
  const apiKey = process.env.FDC_API_KEY;
  if (!apiKey) {
    console.error("Set FDC_API_KEY in .env.local or environment.");
    process.exit(1);
  }

  const seen = new Set();
  const idList = []; // { fdcId, dataType } from search
  let searchRequests = 0;

  console.log("Phase 1: Search to collect fdcIds (target %d unique)...\n", TARGET_FOODS);

  for (const term of SEARCH_TERMS) {
    if (idList.length >= TARGET_FOODS) break;
    try {
      const data = await search(apiKey, term);
      searchRequests++;
      const list = data.foods || [];
      for (const f of list) {
        const id = f.fdcId;
        if (seen.has(id)) continue;
        seen.add(id);
        idList.push({
          fdcId: id,
          dataType: f.dataType ?? "unknown",
        });
        if (idList.length >= TARGET_FOODS) break;
      }
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.warn("Search '%s' failed:", term, err.message);
    }
  }

  console.log("Collected %d fdcIds. Now fetching full detail for each (this uses the detail API so we get serving data for all types)...\n", idList.length);

  const foods = [];
  let fetchRequests = 0;
  let fetchErrors = 0;

  for (let i = 0; i < idList.length; i++) {
    const { fdcId, dataType } = idList[i];
    try {
      const full = await fetchFood(apiKey, fdcId);
      fetchRequests++;
      const servingSize = full.servingSize != null ? Number(full.servingSize) : null;
      const servingSizeUnit = full.servingSizeUnit != null ? String(full.servingSizeUnit).trim() : null;
      const calories = getCalories(full);
      foods.push({
        fdcId,
        description: full.description,
        dataType: full.dataType ?? dataType,
        servingSize,
        servingSizeUnit,
        calories,
      });
      if ((i + 1) % 100 === 0) console.log("  Fetched %d / %d...", i + 1, idList.length);
    } catch (err) {
      fetchErrors++;
      if (fetchErrors <= 3) console.warn("  Fetch fdcId %s failed:", fdcId, err.message);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log("\nFetched %d foods (detail API), %d errors.\n", foods.length, fetchErrors);

  const withServing = (f) =>
    f.servingSize != null &&
    f.servingSizeUnit != null &&
    String(f.servingSizeUnit).trim() !== "";
  const unitIsMg = (f) => {
    const u = normUnit(f.servingSizeUnit);
    return u === "mg" || u === "milligram";
  };
  const impossible = (f) =>
    isImpossibleMg(f.servingSize, f.servingSizeUnit, f.calories);

  for (const f of foods) {
    f.hasServing = withServing(f);
    f.unitMg = f.hasServing && unitIsMg(f);
    f.impossibleMg = f.unitMg && impossible(f);
  }

  const byType = {};
  for (const f of foods) {
    const t = f.dataType || "unknown";
    if (!byType[t]) {
      byType[t] = {
        total: 0,
        withServing: 0,
        unitMg: 0,
        impossibleMg: 0,
        examples: [],
      };
    }
    byType[t].total++;
    if (f.hasServing) byType[t].withServing++;
    if (f.unitMg) {
      byType[t].unitMg++;
      if (f.impossibleMg) {
        byType[t].impossibleMg++;
        if (byType[t].examples.length < 5) {
          byType[t].examples.push({
            fdcId: f.fdcId,
            description: (f.description || "").slice(0, 60),
            servingSize: f.servingSize,
            servingSizeUnit: f.servingSizeUnit,
            calories: f.calories,
          });
        }
      }
    }
  }

  console.log("--- By dataType (from FULL DETAIL response) ---\n");
  const order = Object.keys(byType).sort(
    (a, b) => byType[b].total - byType[a].total
  );
  for (const t of order) {
    const s = byType[t];
    console.log(
      "%s: total=%d  with_serving=%d  unit_mg=%d  impossible_mg=%d",
      t,
      s.total,
      s.withServing,
      s.unitMg,
      s.impossibleMg
    );
    if (s.impossibleMg > 0 && s.examples.length) {
      console.log("  Examples (impossible):");
      for (const ex of s.examples) {
        console.log(
          "    FDC %s | %s %s %s = %s cal",
          ex.fdcId,
          ex.servingSize,
          ex.servingSizeUnit,
          ex.description ? "| " + ex.description : "",
          ex.calories
        );
      }
    }
    console.log("");
  }

  const totalImpossible = foods.filter((f) => f.impossibleMg).length;
  const totalMg = foods.filter((f) => f.unitMg).length;
  console.log("--- Overall ---");
  console.log("Total foods (with detail): %d", foods.length);
  console.log("With serving size+unit: %d", foods.filter(withServing).length);
  console.log("Serving unit = mg: %d", totalMg);
  console.log("Impossible (mg + cal/100g > 900): %d", totalImpossible);
  if (totalMg > 0) {
    console.log("Impossible as %% of mg: %d%%", Math.round((100 * totalImpossible) / totalMg));
  }

  const outPath = join(root, "scripts", "usda-serving-analysis.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: {
          totalFoods: foods.length,
          searchRequests,
          fetchRequests,
          fetchErrors,
          totalImpossible,
          totalMg,
          byType,
          note: "Serving data from GET /food/{fdcId} (full detail), not search.",
        },
        foods: foods.map((f) => ({
          fdcId: f.fdcId,
          dataType: f.dataType,
          hasServing: f.hasServing,
          unitMg: f.unitMg,
          impossibleMg: f.impossibleMg,
          servingSize: f.servingSize,
          servingSizeUnit: f.servingSizeUnit,
          calories: f.calories,
        })),
      },
      null,
      2
    ),
    "utf8"
  );
  console.log("\nFull results written to %s", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
