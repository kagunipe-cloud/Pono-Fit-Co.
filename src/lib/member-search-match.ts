/** Fields used for staff/member typeahead search. */
export type MemberSearchRow = {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  email?: string | null;
  member_id?: string | null;
};

export function memberDisplayName(row: MemberSearchRow): string {
  const preferred = String(row.preferred_name ?? "").trim();
  if (preferred) return preferred;
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || String(row.member_id ?? "").trim() || "Member";
}

/** Every whitespace-separated token must appear somewhere in name, email, or member id. */
export function memberRowMatchesSearch(row: MemberSearchRow, q: string): boolean {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [
    row.preferred_name,
    row.first_name,
    row.last_name,
    [row.first_name, row.last_name].filter(Boolean).join(" "),
    row.email,
    row.member_id,
  ]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => hay.includes(t));
}
