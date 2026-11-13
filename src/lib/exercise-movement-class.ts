/** Compound vs isolation for lifts (stretch/cardio typically unset). */

export const MOVEMENT_CLASS_VALUES = ["compound", "isolation"] as const;
export type MovementClass = (typeof MOVEMENT_CLASS_VALUES)[number];

export function parseMovementClass(
  raw: string | null | undefined,
  exerciseType: string
): MovementClass | null {
  if (exerciseType !== "lift") return null;
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "compound") return "compound";
  if (s === "isolation") return "isolation";
  return null;
}

export function movementClassLabel(value: MovementClass | null | undefined): string {
  if (value === "compound") return "Compound";
  if (value === "isolation") return "Isolation";
  return "—";
}
