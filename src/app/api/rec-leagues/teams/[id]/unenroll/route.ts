import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../../../lib/rec-leagues";
import { getMemberIdFromSession } from "../../../../../../lib/session";

export const dynamic = "force-dynamic";

/** POST: remove team from a league. Body: { league_id }. Only the team admin can do this. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const teamId = parseInt((await params).id, 10);
  if (Number.isNaN(teamId)) {
    return NextResponse.json({ error: "Invalid team id" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const league_id = parseInt(String(body.league_id), 10);
    if (!league_id) {
      return NextResponse.json({ error: "league_id required" }, { status: 400 });
    }
    const db = getDb();
    ensureRecLeaguesTables(db);
    const team = db.prepare("SELECT id, created_by_member_id FROM rec_teams WHERE id = ?").get(teamId) as
      | { id: number; created_by_member_id: string | null }
      | undefined;
    if (!team) {
      db.close();
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    if (team.created_by_member_id !== memberId) {
      db.close();
      return NextResponse.json({ error: "Only the team admin can unenroll this team" }, { status: 403 });
    }
    db.prepare("DELETE FROM rec_team_league_enrollments WHERE team_id = ? AND league_id = ?").run(teamId, league_id);
    db.close();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to unenroll" },
      { status: 500 }
    );
  }
}
