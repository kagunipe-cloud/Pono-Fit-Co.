/** Optional ISO date YYYY-MM-DD; empty clears. */
export function parseBirthday(
  raw: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return { ok: false, message: "Birthday must be YYYY-MM-DD." };
  }
  const y = parseInt(t.slice(0, 4), 10);
  const mo = parseInt(t.slice(5, 7), 10);
  const day = parseInt(t.slice(8, 10), 10);
  const d = new Date(y, mo - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) {
    return { ok: false, message: "Birthday is not a valid calendar date." };
  }
  return { ok: true, value: t };
}
