import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../lib/rec-leagues";

export const dynamic = "force-dynamic";

/** GET ?token=xxx — validate token, return team name and member name for the waiver page. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ valid: false, error: "Missing token" }, { status: 400 });
  }
  try {
    const db = getDb();
    ensureRecLeaguesTables(db);
    const row = db.prepare(
      `SELECT w.id, w.team_member_id, w.expires_at, w.signed_at,
              m.first_name, m.last_name, m.email, m.waiver_signed_at,
              t.name AS team_name
       FROM rec_waiver_tokens w
       JOIN rec_team_members m ON m.id = w.team_member_id
       JOIN rec_teams t ON t.id = m.team_id
       WHERE w.token = ?`
    ).get(token) as {
      id: number;
      team_member_id: number;
      expires_at: string;
      signed_at: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string;
      waiver_signed_at: string | null;
      team_name: string;
    } | undefined;
    db.close();
    if (!row) {
      return NextResponse.json({ valid: false, error: "Invalid or expired link" }, { status: 404 });
    }
    const now = new Date().toISOString();
    if (row.expires_at < now) {
      return NextResponse.json({ valid: false, expired: true, error: "This waiver link has expired" }, { status: 400 });
    }
    if (row.signed_at || row.waiver_signed_at) {
      return NextResponse.json({ valid: false, already_signed: true, error: "This waiver has already been signed" }, { status: 400 });
    }
    const memberName = [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email;
    return NextResponse.json({
      valid: true,
      team_name: row.team_name,
      member_name: memberName,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ valid: false, error: "Something went wrong" }, { status: 500 });
  }
}
