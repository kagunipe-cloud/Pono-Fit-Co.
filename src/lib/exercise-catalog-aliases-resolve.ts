import aliasBundle from "./exercise-catalog-aliases.json";
import { exerciseNameMatchKeys } from "./exercise-catalog-match";

type ResolvedAlias = {
  to: string;
  section: string;
  rank: number;
};

const aliasKeyToTarget = new Map<string, ResolvedAlias>();

for (const entry of aliasBundle.entries) {
  for (const key of exerciseNameMatchKeys(entry.from)) {
    aliasKeyToTarget.set(key, {
      to: entry.to,
      section: entry.section,
      rank: entry.rank,
    });
  }
}

/** If `from` is aliased, returns the curated catalog title — else the original name. */
export function resolveCatalogAliasName(exerciseName: string): string {
  for (const key of exerciseNameMatchKeys(exerciseName)) {
    const hit = aliasKeyToTarget.get(key);
    if (hit) return hit.to;
  }
  return exerciseName;
}

/** Direct rank from a validated alias (after build), when section matches lookup. */
export function catalogAliasRankForSection(sectionKey: string, exerciseName: string): number | null {
  for (const key of exerciseNameMatchKeys(exerciseName)) {
    const hit = aliasKeyToTarget.get(key);
    if (hit && hit.section === sectionKey) return hit.rank;
  }
  return null;
}