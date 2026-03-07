import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getGymBranding, DEFAULT_GYM_ID } from "@/lib/gyms";

export const dynamic = "force-dynamic";

/**
 * GET ?gym_id=1 — Returns branding for the gym (name, logo, colors).
 * Use gym_id from session/subdomain when multi-tenant. Default: 1.
 */
export async function GET(request: NextRequest) {
  try {
    const gymIdParam = request.nextUrl.searchParams.get("gym_id");
    const gymId = gymIdParam ? parseInt(gymIdParam, 10) : DEFAULT_GYM_ID;
    const db = getDb();
    const branding = getGymBranding(db, gymId);
    db.close();
    return NextResponse.json(branding);
  } catch (err) {
    console.error("[api/branding]", err);
    return NextResponse.json({ error: "Failed to load branding" }, { status: 500 });
  }
}
