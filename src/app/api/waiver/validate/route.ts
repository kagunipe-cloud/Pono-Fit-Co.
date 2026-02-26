import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET ?token=xxx — Validate waiver token; return member_id and first_name for the sign page. Public. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT member_id, first_name FROM members WHERE waiver_token = ? AND waiver_token_expires_at > datetime('now')`
    ).get(token) as { member_id: string; first_name: string | null } | undefined;
    db.close();
    if (!row) {
      return NextResponse.json({ error: "Invalid or expired link. Request a new one from the gym." }, { status: 401 });
    }
    return NextResponse.json({
      member_id: row.member_id,
      first_name: row.first_name?.trim() || null,
    });
  } catch (err) {
    console.error("[waiver/validate]", err);
    return NextResponse.json({ error: "Failed to validate" }, { status: 500 });
  }
}
