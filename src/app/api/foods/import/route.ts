import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureFoodsTable } from "@/lib/macros";
import { validateFood, serializeDataQuality } from "@/lib/food-quality";

export const dynamic = "force-dynamic";

/**
 * Normalize macro value from various import field names.
 * Accepts: name/description/food_name, calories/energy_kcal, protein_g/protein, fat_g/fat/total_fat, carbs_g/carbs/carbohydrates, fiber_g/fiber, serving_description/serving_size.
 */
function pickNum(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    const n = parseFloat(String(v));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** Parse one CSV line respecting quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else cell += c;
    } else if (c === ",") {
      out.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else current += c;
  }
  if (current.trim()) lines.push(current);
  return lines;
}

/**
 * POST — bulk import foods.
 * Body: { foods: [ { name, calories, protein_g, ... } ] } or a raw array of food objects.
 * Recognized keys (case-sensitive in JSON): name, description, food_name, calories, energy_kcal, protein_g, protein, fat_g, fat, total_fat, carbs_g, carbs, carbohydrates, fiber_g, fiber, serving_description, serving_size, source.
 * Alternatively: { csv: "..." } with a header row. Header names are matched case-insensitively (e.g. Name, Calories, Protein (g), Fat, Carbs, Fiber, Serving).
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    let items: { name: string; calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null; fiber_g: number | null; serving_description: string | null; source: string }[] = [];

    if (typeof body.csv === "string" && body.csv.trim()) {
      const lines = splitCsvLines(body.csv.trim());
      const headerLine = lines[0] ?? "";
      const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
      const nameIdx = headers.findIndex((h) => h === "name" || h === "description" || h === "food_name" || h === "food name");
      const calIdx = headers.findIndex((h) => h === "calories" || h === "energy_kcal" || h === "energy");
      const proteinIdx = headers.findIndex((h) => h === "protein_g" || h === "protein" || h.includes("protein"));
      const fatIdx = headers.findIndex((h) => h === "fat_g" || h === "fat" || h === "total_fat" || h.includes("fat"));
      const carbsIdx = headers.findIndex((h) => h === "carbs_g" || h === "carbs" || h === "carbohydrates" || h.includes("carb"));
      const fiberIdx = headers.findIndex((h) => h === "fiber_g" || h === "fiber");
      const servingIdx = headers.findIndex((h) => h === "serving_description" || h === "serving_size" || h === "serving" || h.includes("serving"));
      const sourceIdx = headers.findIndex((h) => h === "source");

      if (nameIdx === -1) {
        return NextResponse.json({ error: "CSV must have a name column (name, description, or food_name)" }, { status: 400 });
      }

      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const name = (cells[nameIdx] ?? "").trim().replace(/^"|"$/g, "");
        if (!name) continue;
        const num = (idx: number) => {
          if (idx === -1) return null;
          const v = cells[idx];
          if (v == null || v === "") return null;
          const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
          return Number.isNaN(n) ? null : n;
        };
        items.push({
          name,
          calories: num(calIdx),
          protein_g: num(proteinIdx),
          fat_g: num(fatIdx),
          carbs_g: num(carbsIdx),
          fiber_g: num(fiberIdx),
          serving_description: servingIdx >= 0 && cells[servingIdx] ? String(cells[servingIdx]).trim() : null,
          source: sourceIdx >= 0 && cells[sourceIdx] ? String(cells[sourceIdx]).trim() : "csv",
        });
      }
    } else {
      const raw = Array.isArray(body.foods) ? body.foods : Array.isArray(body) ? body : [];
      for (const row of raw) {
        const o = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
        const name = pickStr(o, "name", "description", "food_name");
        if (!name) continue;
        items.push({
          name,
          calories: pickNum(o, "calories", "energy_kcal", "Energy"),
          protein_g: pickNum(o, "protein_g", "protein", "Protein"),
          fat_g: pickNum(o, "fat_g", "fat", "total_fat", "Total lipid (fat)"),
          carbs_g: pickNum(o, "carbs_g", "carbs", "carbohydrates", "Carbohydrate, by difference"),
          fiber_g: pickNum(o, "fiber_g", "fiber", "Fiber, total dietary"),
          serving_description: pickStr(o, "serving_description", "serving_size", "servingSize") ?? null,
          source: (pickStr(o, "source") ?? "import") as string,
        });
      }
    }

    const db = getDb();
    ensureFoodsTable(db);
    const hasDataQuality = (db.prepare("PRAGMA table_info(foods)").all() as { name: string }[]).some((c) => c.name === "data_quality");
    const insert = hasDataQuality
      ? db.prepare(
          "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source, data_quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
      : db.prepare(
          "INSERT INTO foods (name, calories, protein_g, fat_g, carbs_g, fiber_g, serving_description, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
    let added = 0;
    for (const it of items) {
      const validation = validateFood({ calories: it.calories, protein_g: it.protein_g, fat_g: it.fat_g, carbs_g: it.carbs_g, fiber_g: it.fiber_g });
      const data_quality = serializeDataQuality(validation.dataQualityFlags);
      if (hasDataQuality) {
        insert.run(it.name, it.calories, it.protein_g, it.fat_g, it.carbs_g, it.fiber_g, it.serving_description, it.source, data_quality);
      } else {
        insert.run(it.name, it.calories, it.protein_g, it.fat_g, it.carbs_g, it.fiber_g, it.serving_description, it.source);
      }
      added++;
    }
    db.close();
    return NextResponse.json({ added, total: items.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to import foods" }, { status: 500 });
  }
}
