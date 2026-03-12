/**
 * Normalize exercise names for matching (e.g. our DB vs free-exercise-db).
 * Preserves qualifiers like "medium grip", "wide grip" — those differentiate exercises.
 * Only homogenizes degree symbols (Â° → °) and does case/whitespace cleanup.
 */

export function normalizeForMatch(name: string): string {
  let s = (name ?? "").trim().toLowerCase();
  if (!s) return "";

  // Homogenize degree symbols (encoding issues: Â°, º, etc. → °)
  s = s.replace(/Â°/g, "°").replace(/º/g, "°");
  // Collapse multiple spaces
  s = s.replace(/\s+/g, " ").trim();

  return s;
}
