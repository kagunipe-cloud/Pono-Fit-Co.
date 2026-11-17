/**
 * Rough coverage: catalog vs FitnessDB / CSV names.
 *   npx tsx scripts/report-catalog-name-match.ts
 */

import fs from "fs";
import path from "path";
import catalogData from "../src/lib/exercise-catalog-order.json";
import {
  catalogRankForRegion,
  hasCatalogRankForRegion,
  MUSCLE_REGION_CATALOG_SECTIONS,
} from "../src/lib/exercise-catalog-order";

const FITNESS_CSV = path.join(process.cwd(), "FitnessDB/Exercises-Table 1.csv");

function namesFromFitnessCsv(): string[] {
  if (!fs.existsSync(FITNESS_CSV)) return [];
  const text = fs.readFileSync(FITNESS_CSV, "utf8");
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^,([^,]+),/);
    const n = m?.[1]?.trim() ?? "";
    if (n.length < 4) continue;
    if (/^[*"']|download|update notes|youtube|resources|abc trainerize|^\d+$/i.test(n)) continue;
    if (!/[a-z]/i.test(n)) continue;
    names.push(n);
  }
  return [...new Set(names)];
}

const SECTION_DEFAULT_REGION: Record<string, string> = {
  "quad-dominant-legs": "quads",
  "hamstring-dominant-legs": "hamstrings",
  "glute-hip-dominant": "glutes",
  "calves-tibialis": "calves-back",
  "core-abs": "core",
  back: "lats",
  shoulders: "shoulders",
  chest: "chest",
  biceps: "biceps",
  triceps: "triceps",
  traps: "traps",
};

function sampleRegionForName(name: string): string {
  const lower = name.toLowerCase();
  if (/\bcurl\b|bicep/.test(lower)) return "biceps";
  if (/\btricep|pushdown|skull/.test(lower)) return "triceps";
  if (/\bbench|push-up|fly|pec/.test(lower)) return "chest";
  if (/\bsquat|lunge|leg press|leg extension/.test(lower)) return "quads";
  if (/\bdeadlift|leg curl|rdl|hamstring/.test(lower)) return "hamstrings";
  if (/\brow|pulldown|pull-up|lat/.test(lower)) return "lats";
  if (/\braise|shoulder|overhead press/.test(lower)) return "shoulders";
  return "chest";
}

function main() {
  const external = namesFromFitnessCsv();

  let selfMatch = 0;
  let catalogTotal = 0;
  for (const [sectionKey, names] of Object.entries(catalogData.sections)) {
    const region = SECTION_DEFAULT_REGION[sectionKey] ?? "chest";
    for (const n of names) {
      catalogTotal++;
      if (hasCatalogRankForRegion(region, n)) selfMatch++;
    }
  }
  console.log(`Catalog self-match (correct section): ${selfMatch}/${catalogTotal}`);

  if (external.length === 0) {
    console.log("No FitnessDB CSV — skip external sample.");
    return;
  }

  let matched = 0;
  const misses: string[] = [];
  for (const n of external) {
    const region = sampleRegionForName(n);
    if (catalogRankForRegion(region, n) < 1_000_000) matched++;
    else if (misses.length < 25) misses.push(n);
  }
  console.log(`FitnessDB names matched (heuristic region): ${matched}/${external.length}`);
  console.log("Sample misses:", misses.slice(0, 15));
  console.log("Regions:", Object.keys(MUSCLE_REGION_CATALOG_SECTIONS).length);
}

main();