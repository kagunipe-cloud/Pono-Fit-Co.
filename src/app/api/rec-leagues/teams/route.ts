import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../lib/rec-leagues";
import { getMemberIdFromSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** POST: create a team. Body: { name }. Caller becomes team admin (created_by_member_id). Requires sign-in. */
export async function POST(request: NextRequest) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in required to create a team" }, { status: 401 });
  }
  try {
    let body: { name?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const name = (body?.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Team name required" }, { status: 400 });
    }
    const db = getDb();
    ensureRecLeaguesTables(db);
    db.exec("PRAGMA foreign_keys = OFF");
    const member = db.prepare(
      "SELECT email, first_name, last_name FROM members WHERE member_id = ?"
    ).get(memberId) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
    const email = (member?.email ?? "").trim() || `${memberId}@rec-league.local`;
    const displayName = [member?.first_name, member?.last_name].filter(Boolean).join(" ") || "Team admin";
    const result = db.prepare(
      "INSERT INTO rec_teams (name, created_by_member_id) VALUES (?, ?)"
    ).run(name, memberId);
    const teamId = result.lastInsertRowid as number;
    db.prepare(
      "INSERT INTO rec_team_members (team_id, email, name, member_id, role) VALUES (?, ?, ?, ?, 'admin')"
    ).run(teamId, email, displayName, memberId);
    const row = db.prepare("SELECT id, name, created_by_member_id, created_at FROM rec_teams WHERE id = ?").get(teamId);
    db.exec("PRAGMA foreign_keys = ON");
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to create team" },
      { status: 500 }
    );
  }
}

/** GET: list all teams (public). Optional ?league_id= to filter by league. Returns created_by_member_id so UI can show enroll for team admins. */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    ensureRecLeaguesTables(db);
    const leagueId = request.nextUrl.searchParams.get("league_id");
    let rows: { id: number; name: string; created_at: string; created_by_member_id: string | null; league_names?: string }[];
    if (leagueId) {
      rows = db
        .prepare(
          `SELECT t.id, t.name, t.created_at, t.created_by_member_id
           FROM rec_teams t
           INNER JOIN rec_team_league_enrollments e ON e.team_id = t.id AND e.league_id = ?
           ORDER BY t.name ASC`
        )
        .all(parseInt(leagueId, 10)) as { id: number; name: string; created_at: string; created_by_member_id: string | null }[];
    } else {
      rows = db
        .prepare(
          `SELECT t.id, t.name, t.created_at, t.created_by_member_id FROM rec_teams t ORDER BY t.name ASC`
        )
        .all() as { id: number; name: string; created_at: string; created_by_member_id: string | null }[];
    }
    if (rows.length > 0 && !leagueId) {
      const withLeagues = rows.map((t) => {
        const leagueRows = db.prepare(
          `SELECT l.name FROM rec_team_league_enrollments e JOIN rec_leagues l ON l.id = e.league_id WHERE e.team_id = ?`
        ).all(t.id) as { name: string }[];
        return { ...t, league_names: leagueRows.map((r) => r.name) };
      });
      db.close();
      return NextResponse.json(withLeagues);
    }
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch teams" },
      { status: 500 }
    );
  }
}
