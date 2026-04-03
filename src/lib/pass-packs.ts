/** Day-based pass products (5-day / 10-day packs): bank credits, activate one day at a time. */

export function isPassPackPlan(plan: { category?: string | null; unit?: string | null }): boolean {
  return String(plan.category ?? "").trim() === "Passes" && String(plan.unit ?? "").trim() === "Day";
}

export function passCreditsForPurchase(plan: { length?: string | null }, quantity: number): number {
  const n = Math.max(0, parseInt(String(plan.length ?? "0"), 10) || 0);
  const q = Math.max(1, quantity);
  return n * q;
}
