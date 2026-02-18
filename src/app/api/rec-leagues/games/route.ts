import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../lib/rec-leagues";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

/** GET: list all games (public) with league and team names. */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    ensureRecLeaguesTables(db);
    const leagueId = request.nextUrl.searchParams.get("league_id");
    let query = `
      SELECT g.id, g.league_id, g.home_team_id, g.away_team_id, g.game_date, g.game_time, g.location,
             l.name AS league_name,
             ht.name AS home_team_name,
             at.name AS away_team_name
      FROM rec_games g
      LEFT JOIN rec_leagues l ON l.id = g.league_id
      LEFT JOIN rec_teams ht ON ht.id = g.home_team_id
      LEFT JOIN rec_teams at ON at.id = g.away_team_id
      WHERE 1=1
    `;
    const params: (number | string)[] = [];
    if (leagueId) {
      query += " AND g.league_id = ?";
      params.push(parseInt(leagueId, 10));
    }
    query += " ORDER BY g.game_date ASC, g.game_time ASC";
    const rows = (params.length ? db.prepare(query).all(...params) : db.prepare(query).all()) as Record<string, unknown>[];
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch games" },
      { status: 500 }
    );
  }
}

/** POST: create a game (app admin only). Body: league_id, home_team_id, away_team_id, game_date, game_time?, location? */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const league_id = parseInt(String(body.league_id), 10);
    const home_team_id = parseInt(String(body.home_team_id), 10);
    const away_team_id = parseInt(String(body.away_team_id), 10);
    const game_date = String(body.game_date ?? "").trim();
    const game_time = body.game_time != null ? String(body.game_time).trim() : null;
    const location = body.location != null ? String(body.location).trim() : null;

    if (!league_id || !home_team_id || !away_team_id || !game_date) {
      return NextResponse.json(
        { error: "league_id, home_team_id, away_team_id, and game_date required" },
        { status: 400 }
      );
    }
    if (home_team_id === away_team_id) {
      return NextResponse.json(
        { error: "Home and away team must be different" },
        { status: 400 }
      );
    }
    const db = getDb();
    ensureRecLeaguesTables(db);
    db.prepare(
      `INSERT INTO rec_games (league_id, home_team_id, away_team_id, game_date, game_time, location)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(league_id, home_team_id, away_team_id, game_date, game_time, location);
    const row = db.prepare("SELECT id, league_id, home_team_id, away_team_id, game_date, game_time, location FROM rec_games ORDER BY id DESC LIMIT 1").get();
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to create game" },
      { status: 500 }
    );
  }
}
