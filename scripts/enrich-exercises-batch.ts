/**
 * Batch muscle + difficulty enrichment from the terminal (same logic as admin /exercises buttons).
 *
 * Usage (from repo root, with GEMINI_API_KEY + SERPER_API_KEY in .env.local):
 *   npm run enrich-exercises
 *   npm run enrich-exercises -- --muscles-only
 *   npm run enrich-exercises -- --difficulty-only --limit 50
 *   npm run enrich-exercises -- --force --apply-low
 *
 * On Railway (production DB + env already set):
 *   railway run npm run enrich-exercises
 *   # or in Railway Shell: cd /app && npm run enrich-exercises
 */

import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

import { getDb } from "../src/lib/db";
import { enrichExerciseMusclesFromWeb, ensureExerciseMuscleEnrichColumns } from "../src/lib/exercise-muscle-enrich";
import { lookupExerciseDifficultyFromWeb, needsDifficultyRefresh, ensureExerciseDifficultyCacheTable } from "../src/lib/exercise-difficulty";

type Row = { id: number; name: string; type: string };

function parseArgs(argv: string[]) {
  const musclesOnly = argv.includes("--muscles-only");
  const difficultyOnly = argv.includes("--difficulty-only");
  const runMuscles = difficultyOnly ? false : true;
  const runDifficulty = musclesOnly ? false : true;

  let limit = 0;
  let sleepMs = 1200;
  let typeFilter: string | null = null;
  let force = false;
  let applyLow = false;

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) limit = Math.max(0, parseInt(arg.slice("--limit=".length), 10) || 0);
    if (arg.startsWith("--sleep=")) sleepMs = Math.max(0, parseInt(arg.slice("--sleep=".length), 10) || 0);
    if (arg.startsWith("--type=")) typeFilter = arg.slice("--type=".length).trim() || null;
    if (arg === "--force") force = true;
    if (arg === "--apply-low") applyLow = true;
  }

  return { runMuscles, runDifficulty, limit, sleepMs, typeFilter, force, applyLow };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function needsMuscleEnrich(
  row: Row & { primary_muscles?: string | null; movement_class?: string | null; muscles_enriched_at?: string | null },
  force: boolean
): boolean {
  if (force) return true;
  const noEnrich = !(row.muscles_enriched_at ?? "").trim();
  const noPrimary = !(row.primary_muscles ?? "").trim();
  const liftMissingCi = row.type === "lift" && !(row.movement_class ?? "").trim();
  return noEnrich || noPrimary || liftMissingCi;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error("GEMINI_API_KEY is required (set in .env.local or Railway variables).");
    process.exit(1);
  }
  if (!process.env.SERPER_API_KEY?.trim()) {
    console.warn("SERPER_API_KEY not set — lookups may be weaker (Gemini-only).");
  }

  const db = getDb();
  ensureExerciseMuscleEnrichColumns(db);
  ensureExerciseDifficultyCacheTable(db);

  let rows = db
    .prepare(
      `SELECT id, name, type, primary_muscles, movement_class, muscles_enriched_at
       FROM exercises
       ORDER BY id`
    )
    .all() as Array<Row & { primary_muscles: string | null; movement_class: string | null; muscles_enriched_at: string | null }>;

  if (args.typeFilter && args.typeFilter !== "all") {
    rows = rows.filter((r) => r.type === args.typeFilter);
  }

  if (args.runMuscles) {
    const muscleQueue = rows.filter((r) => needsMuscleEnrich(r, args.force));
    const toProcess = args.limit > 0 ? muscleQueue.slice(0, args.limit) : muscleQueue;

    console.log(`\nMuscles: ${toProcess.length} exercise(s) to process (${muscleQueue.length} need enrich, ${rows.length} in filter).`);

    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const row = toProcess[i]!;
      process.stdout.write(`[${i + 1}/${toProcess.length}] #${row.id} ${row.name} … `);
      try {
        const result = await enrichExerciseMusclesFromWeb(db, row.id, row.name, row.type, {
          force: args.force,
          applyLow: args.applyLow,
        });
        if (!result) {
          console.log("failed");
          failed++;
        } else if (result.applied) {
          console.log(`saved (${result.confidence})`);
          applied++;
        } else {
          console.log(`skipped (${result.confidence})`);
          skipped++;
        }
      } catch (e) {
        console.log(`error: ${e instanceof Error ? e.message : "unknown"}`);
        failed++;
      }
      if (args.sleepMs > 0 && i < toProcess.length - 1) await sleep(args.sleepMs);
    }

    console.log(`Muscles done: ${applied} saved, ${skipped} skipped, ${failed} failed.`);
  }

  if (args.runDifficulty) {
    const diffQueue = rows.filter((r) => args.force || needsDifficultyRefresh(db, r.id));
    const toProcess = args.limit > 0 ? diffQueue.slice(0, args.limit) : diffQueue;

    console.log(`\nDifficulty: ${toProcess.length} exercise(s) to process (${diffQueue.length} need enrich).`);

    let ok = 0;
    let failed = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const row = toProcess[i]!;
      process.stdout.write(`[${i + 1}/${toProcess.length}] #${row.id} ${row.name} … `);
      try {
        const level = await lookupExerciseDifficultyFromWeb(db, row.id, row.name, row.type, {
          force: args.force,
        });
        if (level) {
          console.log(level);
          ok++;
        } else {
          console.log("no result");
          failed++;
        }
      } catch (e) {
        console.log(`error: ${e instanceof Error ? e.message : "unknown"}`);
        failed++;
      }
      if (args.sleepMs > 0 && i < toProcess.length - 1) await sleep(args.sleepMs);
    }

    console.log(`Difficulty done: ${ok} rated, ${failed} no result.`);
  }

  db.close();
  console.log("\nAll finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});