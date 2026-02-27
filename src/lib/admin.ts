import { NextRequest } from "next/server";
import { getDb } from "./db";
import { getMemberIdFromSession } from "./session";

/**
 * Get the member_id of the current admin (must have role === "Admin").
 * Checks session first, then X-Admin-Member-Id header (for staff using member profile without logging in).
 */
export async function getAdminMemberId(request?: NextRequest): Promise<string | null> {
  let candidate: string | null = await getMemberIdFromSession();
  if (!candidate && request) {
    const header = request.headers.get("X-Admin-Member-Id")?.trim();
    if (header) candidate = header;
  }
  if (!candidate) return null;
  const db = getDb();
  const row = db.prepare("SELECT role FROM members WHERE member_id = ?").get(candidate) as { role: string | null } | undefined;
  db.close();
  return row?.role === "Admin" ? candidate : null;
}

/**
 * Get the member_id of the current trainer (role === "Trainer" or "Admin").
 * Used for trainer schedule access; admins can also act as trainers.
 */
export async function getTrainerMemberId(request?: NextRequest): Promise<string | null> {
  let candidate: string | null = await getMemberIdFromSession();
  if (!candidate && request) {
    const header = request.headers.get("X-Admin-Member-Id")?.trim();
    if (header) candidate = header;
  }
  if (!candidate) return null;
  const db = getDb();
  const row = db.prepare("SELECT role FROM members WHERE member_id = ?").get(candidate) as { role: string | null } | undefined;
  db.close();
  const role = row?.role ?? "Member";
  return role === "Trainer" || role === "Admin" ? candidate : null;
}
