import catalogData from "./exercise-catalog-order.json";
import { catalogAliasRankForSection, resolveCatalogAliasName } from "./exercise-catalog-aliases-resolve";
import { exerciseNameMatchKeys, fuzzyCatalogRankInSection } from "./exercise-catalog-match";

export type CatalogSectionKey = keyof typeof catalogData.sections;

/** Muscle map region id → catalog sections (in list order) used for ranking */
export const MUSCLE_REGION_CATALOG_SECTIONS: Record<string, CatalogSectionKey[]> = {
  quads: ["quad-dominant-legs"],
  hamstrings: ["hamstring-dominant-legs"],
  glutes: ["glute-hip-dominant"],
  "calves-back": ["calves-tibialis"],
  "anterior-tibialis": ["calves-tibialis"],
  core: ["core-abs"],
  "upper-back": ["back"],
  lats: ["back"],
  "lower-back": ["hamstring-dominant-legs", "back"],
  traps: ["traps", "back"],
  shoulders: ["shoulders"],
  chest: ["chest"],
  biceps: ["biceps"],
  triceps: ["triceps"],
};

const rankBySection = new Map<string, Map<string, number>>();
const sectionNamesInOrder = new Map<string, string[]>();

for (const [sectionKey, names] of Object.entries(catalogData.sections)) {
  sectionNamesInOrder.set(sectionKey, names);
  const map = new Map<string, number>();
  names.forEach((name, index) => {
    for (const key of exerciseNameMatchKeys(name)) {
      if (!map.has(key)) map.set(key, index);
    }
  });
  rankBySection.set(sectionKey, map);
}

const NO_CATALOG_RANK = 1_000_000;
const rankCache = new Map<string, number>();

function lookupKeys(sectionKey: string, exerciseName: string): number | null {
  const map = rankBySection.get(sectionKey);
  if (!map) return null;
  for (const key of exerciseNameMatchKeys(exerciseName)) {
    const rank = map.get(key);
    if (rank != null) return rank;
  }
  return null;
}

/** Lower = earlier in the Pono curated catalog for this muscle-map region */
export function catalogRankForRegion(regionId: string, exerciseName: string): number {
  const cacheKey = `${regionId}\0${exerciseName}`;
  const cached = rankCache.get(cacheKey);
  if (cached != null) return cached;

  const sections = MUSCLE_REGION_CATALOG_SECTIONS[regionId];
  if (!sections?.length) {
    rankCache.set(cacheKey, NO_CATALOG_RANK);
    return NO_CATALOG_RANK;
  }

  const resolvedName = resolveCatalogAliasName(exerciseName);
  let best = NO_CATALOG_RANK;
  for (const sectionKey of sections) {
    const aliasRank = catalogAliasRankForSection(sectionKey, exerciseName);
    if (aliasRank != null && aliasRank < best) best = aliasRank;

    let exact = lookupKeys(sectionKey, resolvedName);
    if (exact == null && resolvedName !== exerciseName) {
      exact = lookupKeys(sectionKey, exerciseName);
    }
    if (exact != null && exact < best) best = exact;

    if (aliasRank == null && exact == null) {
      const names = sectionNamesInOrder.get(sectionKey);
      if (names) {
        let fuzzy = fuzzyCatalogRankInSection(names, resolvedName);
        if (fuzzy == null) fuzzy = fuzzyCatalogRankInSection(names, exerciseName);
        if (fuzzy != null && fuzzy < best) best = fuzzy;
      }
    }
  }

  rankCache.set(cacheKey, best);
  return best;
}

export function hasCatalogRankForRegion(regionId: string, exerciseName: string): boolean {
  return catalogRankForRegion(regionId, exerciseName) < NO_CATALOG_RANK;
}