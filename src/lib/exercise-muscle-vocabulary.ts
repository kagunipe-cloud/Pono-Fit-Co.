import { MUSCLE_TO_GROUP } from "./muscle-groups";

/** Extra terms used on the muscle map (picker) beyond MUSCLE_TO_GROUP keys. */
const MUSCLE_MAP_EXTRA_TERMS = [
  "chest",
  "upper chest",
  "middle back",
  "upper back",
  "lower back",
  "spinal erectors",
  "anterior deltoid",
  "lateral deltoid",
  "posterior deltoid",
  "rear deltoid",
  "front delts",
  "side delts",
  "rear delts",
  "anterior tibialis",
  "tibialis anterior",
  "shins",
  "shin",
  "core",
] as const;

/** Preferred display/canonical string for synonyms (AI + imports normalize to these). */
export const MUSCLE_ALIAS_TO_CANONICAL: Record<string, string> = {
  lats: "latissimus dorsi",
  lat: "latissimus dorsi",
  quads: "quadriceps",
  quad: "quadriceps",
  delts: "deltoid",
  delt: "deltoid",
  "rear delts": "posterior deltoid",
  "front delts": "anterior deltoid",
  "side delts": "lateral deltoid",
  pecs: "pectorals",
  pec: "pectorals",
  abs: "abdominals",
  traps: "trapezius",
  calves: "gastrocnemius",
  calf: "gastrocnemius",
  glutes: "gluteus maximus",
  glute: "gluteus maximus",
  hammies: "hamstrings",
  hams: "hamstrings",
};

let cachedVocabulary: string[] | null = null;

export function getCanonicalMuscleVocabulary(): string[] {
  if (cachedVocabulary) return cachedVocabulary;
  const set = new Set<string>(Object.keys(MUSCLE_TO_GROUP));
  for (const t of MUSCLE_MAP_EXTRA_TERMS) set.add(t);
  for (const c of Object.values(MUSCLE_ALIAS_TO_CANONICAL)) set.add(c);
  cachedVocabulary = [...set].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return cachedVocabulary;
}

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Map free text to one vocabulary term, or null if no match. */
export function normalizeMuscleTerm(raw: string): string | null {
  const key = normKey(raw);
  if (!key) return null;
  if (MUSCLE_ALIAS_TO_CANONICAL[key]) return MUSCLE_ALIAS_TO_CANONICAL[key]!;
  const vocab = getCanonicalMuscleVocabulary();
  if (vocab.includes(key)) return key;
  for (const term of vocab) {
    if (key === term || key.includes(term) || term.includes(key)) {
      if (key.length >= 3 || term.length <= key.length + 2) return term;
    }
  }
  return null;
}

export function normalizeMuscleList(terms: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const canonical = normalizeMuscleTerm(raw);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

export function joinMuscleCsv(terms: string[]): string {
  return normalizeMuscleList(terms).join(", ");
}
