/**
 * Macro muscle categories for stratifying primary muscles (e.g. free-exercise-db).
 * First primary muscle maps to one of: legs, back, chest, shoulders, arms, core.
 */

export const MUSCLE_GROUP_LABELS = ["legs", "back", "chest", "shoulders", "arms", "core"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUP_LABELS)[number];

/** Map individual muscle name (lowercase) -> macro group. Covers free-exercise-db, wger, and anatomical names. */
const MUSCLE_TO_GROUP: Record<string, MuscleGroup> = {
  // Legs
  quadriceps: "legs",
  quads: "legs",
  "quadriceps femoris": "legs",
  hamstrings: "legs",
  calves: "legs",
  glutes: "legs",
  "gluteus maximus": "legs",
  "gluteus medius": "legs",
  "gluteus minimus": "legs",
  adductors: "legs",
  abductors: "legs",
  soleus: "legs",
  "hip flexors": "legs",
  gastrocnemius: "legs",
  "vastus lateralis": "legs",
  "vastus medialis": "legs",
  "vastus intermedius": "legs",
  semitendinosus: "legs",
  semimembranosus: "legs",
  "biceps femoris": "legs",
  sartorius: "legs",
  "tensor fasciae latae": "legs",
  // Back
  lats: "back",
  "latissimus dorsi": "back",
  "middle back": "back",
  "lower back": "back",
  traps: "back",
  trapezius: "back",
  rhomboids: "back",
  "erector spinae": "back",
  "spinal erectors": "back",
  "teres major": "back",
  "teres minor": "back",
  // Chest
  chest: "chest",
  pectorals: "chest",
  "pectoralis major": "chest",
  "pectoralis minor": "chest",
  "upper chest": "chest",
  // Shoulders
  shoulders: "shoulders",
  delts: "shoulders",
  "anterior deltoid": "shoulders",
  "lateral deltoid": "shoulders",
  "posterior deltoid": "shoulders",
  "rear deltoid": "shoulders",
  "front delts": "shoulders",
  "side delts": "shoulders",
  "rear delts": "shoulders",
  deltoid: "shoulders",
  infraspinatus: "shoulders",
  supraspinatus: "shoulders",
  subscapularis: "shoulders",
  "levator scapulae": "shoulders",
  // Arms
  biceps: "arms",
  "biceps brachii": "arms",
  triceps: "arms",
  "triceps brachii": "arms",
  forearms: "arms",
  brachialis: "arms",
  brachioradialis: "arms",
  "wrist flexors": "arms",
  "wrist extensors": "arms",
  // Core
  abdominals: "core",
  abs: "core",
  "rectus abdominis": "core",
  obliques: "core",
  "obliquus externus abdominis": "core",
  "serratus anterior": "core",
  "transverse abdominis": "core",
  "hip flexor": "legs",
};

/** Canonical primary muscles for exercises we override by name (e.g. Bulgarian split squat = legs). */
export const BULGARIAN_SPLIT_SQUAT_MUSCLES = "quadriceps, hamstrings, glutes, hip flexors";

function isBulgarianSplitSquat(name: string | null | undefined): boolean {
  return /bulgarian\s+split\s+squat/.test((name ?? "").trim().toLowerCase());
}

/**
 * Infer macro group from exercise name when primary_muscles don't match (e.g. "assisted chin up" -> back).
 * Uses keyword matching; more specific patterns checked first.
 */
export function getMuscleGroupFromExerciseName(exerciseName: string | null | undefined): MuscleGroup | null {
  const n = (exerciseName ?? "").trim().toLowerCase();
  if (!n) return null;
  // Back: pull, row, chin, lat, deadlift
  if (/\b(chin\s*up|pull\s*up|pullup|pull\s*down|pulldown|lat\s*pull|row|deadlift|shrug|hyperextension|good\s*morning|face\s*pull)\b/.test(n)) return "back";
  if (/\b(reverse\s*fly|back\s*fly)\b/.test(n)) return "back";
  // Arms: curl, tricep, bicep, extension (arm), pushdown
  if (/\b(curl|bicep|tricep|skull\s*crusher|pushdown|wrist\s*curl|preacher)\b/.test(n)) return "arms";
  if (/\b(tricep\s*extension|bicep\s*extension)\b/.test(n)) return "arms";
  // Chest: push up, bench, fly, dip, chest press
  if (/\b(push\s*up|pushup|bench\s*press|chest\s*press|fly|flye|pec\s*deck|dip|dumbbell\s*fly)\b/.test(n)) return "chest";
  // Shoulders: shoulder press, lateral raise, delt, overhead
  if (/\b(shoulder\s*press|overhead\s*press|lateral\s*raise|front\s*raise|delt\s*raise|arnold\s*press|upright\s*row)\b/.test(n)) return "shoulders";
  if (/\b(rear\s*delt|reverse\s*pec\s*deck)\b/.test(n)) return "shoulders";
  // Legs: squat, lunge, leg press, calf, leg curl, step-up, hip thrust, glute
  if (/\b(squat|lunge|leg\s*press|calf|leg\s*curl|leg\s*extension|step\s*up|hip\s*thrust|glute\s*bridge|hack\s*squat|goblet)\b/.test(n)) return "legs";
  if (/\b(bulgarian|split\s*squat)\b/.test(n)) return "legs";
  // Core: crunch, plank, sit-up, ab, hollow
  if (/\b(crunch|plank|sit\s*up|sit-up|ab\s*wheel|hollow\s*hold|leg\s*raise|bicycle\s*crunch)\b/.test(n)) return "core";
  if (/\b(abdominal|abs)\b/.test(n)) return "core";
  return null;
}

/**
 * Derive macro group from primary_muscles string (comma-separated), with optional exercise-name override.
 * Tries each listed muscle in order; if still "core", tries keyword match on exercise name.
 */
export function getMuscleGroup(
  primaryMuscles: string | null | undefined,
  exerciseName?: string | null
): MuscleGroup {
  if (exerciseName != null && isBulgarianSplitSquat(exerciseName)) return "legs";
  const raw = (primaryMuscles ?? "").trim();
  if (raw) {
    const parts = raw.split(",").map((p) => p.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);
    for (const part of parts) {
      const group = MUSCLE_TO_GROUP[part];
      if (group) return group;
    }
  }
  // Fallback: infer from exercise name (e.g. "assisted chin up" -> back)
  const fromName = getMuscleGroupFromExerciseName(exerciseName);
  if (fromName) return fromName;
  return "core";
}

/** Map wger (and similar) category names to our macro group. Use when primary_muscles doesn't match. */
export function getMuscleGroupFromCategory(categoryName: string | null | undefined): MuscleGroup | null {
  const cat = (categoryName ?? "").trim().toLowerCase();
  if (!cat) return null;
  if (cat === "cardio") return "core"; // or keep as lift and use core for display
  if (["chest", "pectorals"].includes(cat)) return "chest";
  if (["back", "lats"].includes(cat)) return "back";
  if (["shoulders", "delts"].includes(cat)) return "shoulders";
  if (["legs", "calves", "thighs", "quadriceps", "hamstrings", "glutes"].includes(cat)) return "legs";
  if (["arms", "biceps", "triceps", "forearms"].includes(cat)) return "arms";
  if (["abs", "core", "abdominals", "waist"].includes(cat)) return "core";
  return null;
}

/** If this exercise name should have canonical muscles overridden (e.g. Bulgarian split squat), return the string; else null. */
export function getCanonicalPrimaryMuscles(exerciseName: string | null | undefined): string | null {
  if (exerciseName != null && isBulgarianSplitSquat(exerciseName)) return BULGARIAN_SPLIT_SQUAT_MUSCLES;
  return null;
}
