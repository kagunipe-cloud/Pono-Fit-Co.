/**
 * Match DB / import exercise names to Pono catalog names (muscle-map sort).
 * Layered: alias keys first, then guarded phrase overlap within a section.
 */

import { normalizeForMatch } from "./exercise-name-normalize";

/** Flip catalog plurals & common import wording to one form (keys only — display unchanged). */
function applyCatalogSynonyms(normalized: string): string {
  return normalized
    .replace(/\b(\d+)\s*-\s*degree\b/g, "$1 degree")
    .replace(/\b(\d+)\s*°\b/g, "$1 degree")
    .replace(/\bdegrees\b/g, "degree")
    .replace(/\bbiceps\b/g, "bicep")
    .replace(/\btriceps\b/g, "tricep")
    .replace(/\bquadriceps\b/g, "quad")
    .replace(/\bhamstrings\b/g, "hamstring")
    .replace(/\bglutes\b/g, "glute")
    .replace(/\bdumbbells\b/g, "dumbbell")
    .replace(/\bkettlebells\b/g, "kettlebell")
    .replace(/\bpush-ups\b/g, "push-up")
    .replace(/\bpull-ups\b/g, "pull-up")
    .replace(/\bsit-ups\b/g, "sit-up")
    .replace(/\s*\/\s*/g, " / ");
}

export function stripExerciseParentheticals(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip catalog list index prefix, e.g. `1,002. Curl` → `Curl`. */
export function stripCatalogIndexPrefix(name: string): string {
  return name.replace(/^[\d,]+\.\s*/, "").trim();
}

function tokenSortedKey(normalized: string): string {
  return normalized
    .split(/\s+/)
    .filter((t) => t.length > 0 && !/^(the|a|an|with|and|or)$/i.test(t))
    .sort()
    .join(" ");
}

/** All lookup keys to try for one exercise title (most specific first). */
export function exerciseNameMatchKeys(name: string): string[] {
  const keys = new Set<string>();
  const add = (raw: string) => {
    const base = normalizeForMatch(raw);
    if (!base) return;
    keys.add(base);
    keys.add(applyCatalogSynonyms(base));
    const sorted = tokenSortedKey(base);
    if (sorted) keys.add(sorted);
    const synSorted = tokenSortedKey(applyCatalogSynonyms(base));
    if (synSorted) keys.add(synSorted);
  };

  add(name);
  const noIndex = stripCatalogIndexPrefix(name);
  if (noIndex !== name.trim()) add(noIndex);

  const stripped = stripExerciseParentheticals(name);
  if (stripped !== name.trim()) add(stripped);

  const strippedNoIndex = stripCatalogIndexPrefix(stripped);
  if (strippedNoIndex !== stripped) add(strippedNoIndex);

  return [...keys];
}

function phraseOverlapRank(normA: string, normB: string): number {
  if (normA === normB) return 1;
  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length <= normB.length ? normB : normA;
  if (shorter.length < 8) return 0;
  if (!longer.includes(shorter)) return 0;
  const atWordEdge =
    longer === shorter ||
    longer.startsWith(`${shorter} `) ||
    longer.endsWith(` ${shorter}`) ||
    longer.includes(` ${shorter} `);
  if (!atWordEdge) return 0;
  const ratio = shorter.length / longer.length;
  return ratio >= 0.72 ? ratio : 0;
}

/**
 * When alias keys miss: pick the best catalog row in this section by phrase overlap.
 * Conservative — avoids matching bare “squat” to every squat variant.
 */
export function fuzzyCatalogRankInSection(
  catalogNamesInOrder: readonly string[],
  dbExerciseName: string
): number | null {
  const dbKeys = exerciseNameMatchKeys(dbExerciseName);
  let bestIndex: number | null = null;
  let bestScore = 0;

  for (let i = 0; i < catalogNamesInOrder.length; i++) {
    const catalog = catalogNamesInOrder[i]!;
    const catKeys = exerciseNameMatchKeys(catalog);
    let score = 0;
    for (const dk of dbKeys) {
      for (const ck of catKeys) {
        score = Math.max(score, phraseOverlapRank(dk, ck));
        if (score >= 0.99) break;
      }
      if (score >= 0.99) break;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore >= 0.72 ? bestIndex : null;
}