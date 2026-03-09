/**
 * Multi-tenant context and query helpers.
 * Use getCurrentGymId() in API routes to scope queries by gym.
 * When migrating to Postgres, add RLS policies that use app.current_gym_id().
 */

import { NextRequest } from "next/server";
import { DEFAULT_GYM_ID } from "./gyms";

/**
 * Get the current gym id from request context.
 * Sources (in order): query param ?gym_id=, header X-Gym-Id, session (future), subdomain (future).
 * Returns DEFAULT_GYM_ID (1) until tenant context (subdomain, session, etc.) is implemented.
 */
export async function getCurrentGymId(request: NextRequest | null): Promise<number> {
  if (!request) return DEFAULT_GYM_ID;
  const param = request.nextUrl?.searchParams?.get("gym_id");
  if (param) {
    const n = parseInt(param, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const header = request.headers.get("x-gym-id");
  if (header) {
    const n = parseInt(header, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  // TODO: session.gym_id when multi-tenant login is added
  // TODO: subdomain → gym mapping (gym1.app.com → gym 1)
  return DEFAULT_GYM_ID;
}

/**
 * Sync version for use when request is not available (e.g. cron, background jobs).
 * Pass gymId explicitly or use default.
 */
export function getGymIdSync(gymId?: number | null): number {
  return gymId ?? DEFAULT_GYM_ID;
}

/**
 * Append gym_id filter to a WHERE clause.
 * Use when building dynamic queries to enforce tenant isolation.
 * Example: `WHERE ${gymWhere("m", 1)} AND m.email = ?` → `WHERE (m.gym_id = 1 OR m.gym_id IS NULL) AND m.email = ?`
 */
export function gymWhere(alias: string, gymId: number): string {
  return `(${alias}.gym_id = ? OR ${alias}.gym_id IS NULL)`;
}

/**
 * Values for gymWhere - pass as first arg to your prepared statement.
 */
export function gymWhereParams(gymId: number): [number] {
  return [gymId];
}
