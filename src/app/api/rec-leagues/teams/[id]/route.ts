import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../../lib/rec-leagues";

export const dynamic = "force-dynamic";

/** GET: team detail + enrolled league ids (public). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid team id" }, { status: 400 });
  }
  try {
    const db = getDb();
    ensureRecLeaguesTables(db);
    const team = db.prepare("SELECT id, name, created_by_member_id, created_at FROM rec_teams WHERE id = ?").get(id) as
      | { id: number; name: string; created_by_member_id: string | null; created_at: string }
      | undefined;
    if (!team) {
      db.close();
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    const leagueRows = db.prepare(
      "SELECT league_id FROM rec_team_league_enrollments WHERE team_id = ?"
    ).all(id) as { league_id: number }[];
    const roster = db.prepare(
      `SELECT id, email, first_name, last_name, name, role, waiver_signed_at
       FROM rec_team_members WHERE team_id = ? ORDER BY id ASC`
    ).all(id) as { id: number; email: string; first_name: string | null; last_name: string | null; name: string | null; role: string; waiver_signed_at: string | null }[];
    db.close();
    return NextResponse.json({
      ...team,
      league_ids: leagueRows.map((r) => r.league_id),
      roster,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch team" },
      { status: 500 }
    );
  }
}
