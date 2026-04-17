/** Shared date-range chips for admin reports (sales, unlocks, insurance). */

export function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getPresetRange(
  preset: "today" | "this-week" | "this-month" | "last-week" | "last-month"
): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === "today") {
    return { from: toYMD(today), to: toYMD(today) };
  }

  if (preset === "this-week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toYMD(monday), to: toYMD(sunday) };
  }

  if (preset === "this-month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: toYMD(first), to: toYMD(last) };
  }

  if (preset === "last-week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + mondayOffset);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    return { from: toYMD(lastMonday), to: toYMD(lastSunday) };
  }

  const firstThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthEnd = new Date(firstThisMonth);
  lastMonthEnd.setDate(0);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  return { from: toYMD(lastMonthStart), to: toYMD(lastMonthEnd) };
}
