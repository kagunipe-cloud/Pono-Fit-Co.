/** Trimmed workout note for exercise / set rows (SQLite TEXT). */

export const MAX_WORKOUT_NOTE_LEN = 2000;

export function normalizeWorkoutNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length <= MAX_WORKOUT_NOTE_LEN ? t : t.slice(0, MAX_WORKOUT_NOTE_LEN);
}
