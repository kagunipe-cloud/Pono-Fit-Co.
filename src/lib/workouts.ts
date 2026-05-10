/**
 * Client-safe workout unit helpers (miles/km, 1RM estimate).
 * Server/API DB setup: `import { ensureWorkoutTables } from "@/lib/workouts-server"`.
 */
export { KM_PER_MILE, milesToKm, kmToMiles, estimate1RM } from "./workout-units";
