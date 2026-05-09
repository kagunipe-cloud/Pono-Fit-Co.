export const EXERCISE_TYPES = ["lift", "cardio", "stretch"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const EXERCISE_TYPE_OPTIONS = [
  { value: "lift", label: "Lift" },
  { value: "cardio", label: "Cardio" },
  { value: "stretch", label: "Stretch" },
] as const satisfies { value: ExerciseType; label: string }[];

export function parseExerciseType(value: unknown, fallback: ExerciseType = "lift"): ExerciseType {
  return EXERCISE_TYPES.includes(value as ExerciseType) ? (value as ExerciseType) : fallback;
}

export function isTimedExerciseType(type: string | null | undefined): boolean {
  return type === "cardio" || type === "stretch";
}
