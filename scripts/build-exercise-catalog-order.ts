/**
 * Parse data/pono-exercise-catalog.txt → src/lib/exercise-catalog-order.json
 * Run: npm run build-exercise-catalog
 */

import fs from "fs";
import path from "path";
import { exerciseNameMatchKeys } from "../src/lib/exercise-catalog-match";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "data/pono-exercise-catalog.txt");
const OUT = path.join(ROOT, "src/lib/exercise-catalog-order.json");
const ALIASES_SRC = path.join(ROOT, "data/exercise-catalog-aliases.json");
const ALIASES_OUT = path.join(ROOT, "src/lib/exercise-catalog-aliases.json");

const SECTION_HEADER =
  /^\d+\.\s+(.+?)\s*\([\d,]+[–\-][\d,]+\)\s*$/;

/** Map section title (from file) → stable key used in app */
const SECTION_KEYS: Record<string, string> = {
  "Quad-Dominant Legs": "quad-dominant-legs",
  "Hamstring-Dominant Legs": "hamstring-dominant-legs",
  "Glute / Hip-Dominant": "glute-hip-dominant",
  "Calves & Tibialis-Dominant": "calves-tibialis",
  "Core, Abs & Trunk Stability": "core-abs",
  Back: "back",
  Shoulders: "shoulders",
  Chest: "chest",
  Biceps: "biceps",
  Triceps: "triceps",
  Traps: "traps",
};

function cleanExerciseName(raw: string): string | null {
  let s = raw.trim();
  if (!s || s.length < 3) return null;
  if (/^\(Note:/i.test(s)) return null;
  if (/^continue\b/i.test(s)) return null;
  s = s.replace(/^[\d,]+\.\s*/, "").replace(/\s+/g, " ").trim();
  if (s.length < 3) return null;
  return s;
}

/** Split run-on lines like `166. Foo 167.Bar` or `1,001. Curl 1,002. Press` */
function splitNumberedRuns(line: string): string[] {
  if (!/(?:^|\s)\d{1,4}[,.]\s*\S/.test(line)) return [];

  const parts = line.split(/(?:(?:^|\s)\d{1,4}[,.]\s*)/).map((p) => p.trim());
  return parts.map(cleanExerciseName).filter((n): n is string => n != null);
}

function parseCatalog(text: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentKey: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = line.match(SECTION_HEADER);
    if (header) {
      const title = header[1]!.trim();
      currentKey = SECTION_KEYS[title] ?? null;
      if (currentKey && !sections[currentKey]) sections[currentKey] = [];
      continue;
    }

    if (!currentKey) continue;

    const fromRun = splitNumberedRuns(line);
    if (fromRun.length > 0) {
      sections[currentKey].push(...fromRun);
      continue;
    }

    // Lines that mix prose + numbered tail (quad specialty note)
    if (/(?:^|\s)\d{1,4}[,.]\s*\S/.test(line)) {
      const before = line.split(/(?:^|\s)\d{1,4}[,.]\s*/)[0]?.trim();
      if (before && !/^\(Note:/i.test(before)) {
        const name = cleanExerciseName(before);
        if (name) sections[currentKey].push(name);
      }
      sections[currentKey].push(...splitNumberedRuns(line));
      continue;
    }

    const name = cleanExerciseName(line);
    if (name) sections[currentKey].push(name);
  }

  return sections;
}

type AliasSourceEntry = { from: string; to: string; section?: string; note?: string };

function findCatalogRank(
  sections: Record<string, string[]>,
  catalogToName: string,
  sectionHint?: string
): { section: string; rank: number } | null {
  const keys = new Set(exerciseNameMatchKeys(catalogToName));
  const sectionKeys = sectionHint
    ? sectionHint in sections
      ? [sectionHint]
      : []
    : Object.keys(sections);

  for (const sectionKey of sectionKeys) {
    const names = sections[sectionKey] ?? [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      for (const k of exerciseNameMatchKeys(name)) {
        if (keys.has(k)) return { section: sectionKey, rank: i };
      }
    }
  }
  return null;
}

function buildResolvedAliases(sections: Record<string, string[]>) {
  if (!fs.existsSync(ALIASES_SRC)) {
    return { entries: [] as Array<{ from: string; to: string; section: string; rank: number }>, warnings: [] as string[] };
  }
  const raw = JSON.parse(fs.readFileSync(ALIASES_SRC, "utf8")) as {
    entries?: AliasSourceEntry[];
  };
  const warnings: string[] = [];
  const entries: Array<{ from: string; to: string; section: string; rank: number }> = [];

  for (const row of raw.entries ?? []) {
    const from = row.from?.trim();
    const to = row.to?.trim();
    if (!from || !to) {
      warnings.push("Skipping alias with empty from/to");
      continue;
    }
    const found = findCatalogRank(sections, to, row.section?.trim());
    if (!found) {
      warnings.push(`Alias "${from}" → "${to}": target not found in catalog`);
      continue;
    }
    entries.push({ from, to, section: found.section, rank: found.rank });
  }

  return { entries, warnings };
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Missing ${SRC}`);
    process.exit(1);
  }
  const text = fs.readFileSync(SRC, "utf8");
  const sections = parseCatalog(text);
  const counts = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length]));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "data/pono-exercise-catalog.txt",
    sections,
    counts,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log("Wrote", OUT);
  console.log(counts);
  const total = Object.values(sections).reduce((n, arr) => n + arr.length, 0);
  console.log("Total names:", total);

  const { entries: aliasEntries, warnings } = buildResolvedAliases(sections);
  fs.writeFileSync(
    ALIASES_OUT,
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        source: "data/exercise-catalog-aliases.json",
        entries: aliasEntries,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Wrote ${ALIASES_OUT} (${aliasEntries.length} aliases)`);
  if (warnings.length > 0) {
    console.warn("Alias warnings:");
    for (const w of warnings) console.warn(" ", w);
  }
}

main();