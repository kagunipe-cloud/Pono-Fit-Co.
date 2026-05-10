/** Cardio distance: DB stores km; UI uses miles. Client-safe pure helpers. */

export const KM_PER_MILE = 1.609344;
export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}
export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

/** Brzycki: 1RM = w * (36 / (37 - r)). Returns null if invalid. */
export function estimate1RM(weight: number, reps: number): number | null {
  if (weight <= 0) return null;
  const r = Math.min(36, Math.max(0, reps));
  const denom = 37 - r;
  if (denom <= 0) return weight;
  return weight * (36 / denom);
}
