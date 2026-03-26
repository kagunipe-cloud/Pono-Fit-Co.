/** Ranking for exercise autocomplete: favorites + frequency + recency + name match, without hiding never-tried moves. */

export type ExerciseStat = { count: number; lastUsed: string | null };

const FAVORITE_SCORE = 1_000_000;

export function daysSince(isoDate: string | null): number {
  if (!isoDate) return 365 * 10;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return 365 * 10;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
}

/** Higher = sort earlier. Never-tried can still get small boosts from query match. */
export function exerciseSearchScore(
  exerciseName: string,
  query: string,
  exerciseId: number,
  stats: Map<number, ExerciseStat>,
  favoriteIds: Set<number>
): number {
  let s = 0;
  if (favoriteIds.has(exerciseId)) s += FAVORITE_SCORE;

  const st = stats.get(exerciseId);
  if (st && st.count > 0) {
    s += 60 * Math.log(1 + st.count);
    const days = daysSince(st.lastUsed);
    s += 40 / (1 + days / 45);
  }

  const ql = query.trim().toLowerCase();
  if (ql.length > 0) {
    const nl = exerciseName.toLowerCase();
    if (nl.startsWith(ql)) s += 150;
    else {
      const parts = nl.split(/[\s,/-]+/);
      if (parts.some((p) => p.startsWith(ql))) s += 80;
      else if (nl.includes(ql)) s += 25;
    }
  }

  return s;
}

/**
 * After sorting by score descending, cap how many “high signal” rows we take so we always leave room
 * for never (or low) history exercises that still match the query (sorted by name).
 */
export function blendRankedWithNeverTried<T extends { id: number; name: string }>(
  rows: T[],
  scoreFn: (row: T) => number,
  options?: { maxTotal?: number; maxHighSignal?: number }
): T[] {
  const maxTotal = options?.maxTotal ?? 30;
  const maxHighSignal = options?.maxHighSignal ?? 20;

  const scored = rows.map((e) => ({ e, score: scoreFn(e) }));
  const positive = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
  const zero = scored.filter((x) => x.score <= 0).sort((a, b) => a.e.name.localeCompare(b.e.name));

  const fromPositive = positive.slice(0, maxHighSignal).map((x) => x.e);
  const need = Math.max(0, maxTotal - fromPositive.length);
  const fromZero = zero.slice(0, need).map((x) => x.e);
  return [...fromPositive, ...fromZero];
}
