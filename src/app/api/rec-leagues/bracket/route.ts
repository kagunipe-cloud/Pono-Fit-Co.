import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../lib/rec-leagues";
import { getAdminMemberId } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

type BracketGame = {
  id: string;
  team1_id?: number | null;
  team2_id?: number | null;
  winner_id?: number | null;
  team1_name?: string | null;
  team2_name?: string | null;
};
type BracketRound = { name: string; games: BracketGame[] };
type BracketJson = { rounds: BracketRound[] };

/** Build empty bracket structure for num_teams (4, 8, or 16). */
function buildEmptyBracket(num_teams: number): BracketJson {
  const numFirstRoundGames = num_teams / 2;
  const rounds: BracketRound[] = [];
  const roundNames = num_teams === 4 ? ["Semifinals", "Final"] : num_teams === 8 ? ["Quarterfinals", "Semifinals", "Final"] : ["Round of 16", "Quarterfinals", "Semifinals", "Final"];
  let gameId = 1;
  let gamesInRound = numFirstRoundGames;
  for (const name of roundNames) {
    const games: BracketGame[] = [];
    for (let i = 0; i < gamesInRound; i++) {
      const id = `r${rounds.length}g${i + 1}`;
      games.push({
        id,
        team1_id: rounds.length === 0 ? null : undefined,
        team2_id: rounds.length === 0 ? null : undefined,
        winner_id: null,
      });
    }
    rounds.push({ name, games });
    gameId += gamesInRound;
    gamesInRound = Math.floor(gamesInRound / 2);
  }
  return { rounds };
}

/** GET: return bracket for league_id (public). Resolves team names. */
export async function GET(request: NextRequest) {
  try {
    const leagueId = request.nextUrl.searchParams.get("league_id");
    if (!leagueId) {
      return NextResponse.json({ error: "league_id required" }, { status: 400 });
    }
    const lid = parseInt(leagueId, 10);
    if (Number.isNaN(lid)) {
      return NextResponse.json({ error: "Invalid league_id" }, { status: 400 });
    }
    const db = getDb();
    ensureRecLeaguesTables(db);
    const league = db.prepare("SELECT id, name FROM rec_leagues WHERE id = ?").get(lid) as { id: number; name: string } | undefined;
    if (!league) {
      db.close();
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }
    const row = db.prepare("SELECT league_id, num_teams, bracket_json, updated_at FROM rec_playoff_brackets WHERE league_id = ?").get(lid) as
      | { league_id: number; num_teams: number; bracket_json: string | null; updated_at: string }
      | undefined;
    const teams = db.prepare(
      `SELECT t.id, t.name FROM rec_teams t
       INNER JOIN rec_team_league_enrollments e ON e.team_id = t.id AND e.league_id = ?
       ORDER BY t.name ASC`
    ).all(lid) as { id: number; name: string }[];
    const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));
    db.close();

    if (!row) {
      return NextResponse.json({
        league_id: league.id,
        league_name: league.name,
        num_teams: null,
        bracket: null,
        teams,
      });
    }
    let bracket: BracketJson = { rounds: [] };
    if (row.bracket_json) {
      try {
        bracket = JSON.parse(row.bracket_json) as BracketJson;
      } catch {
        bracket = buildEmptyBracket(row.num_teams);
      }
    } else {
      bracket = buildEmptyBracket(row.num_teams);
    }
    // Derive team1/team2 for rounds after the first from previous round winners
    for (let r = 1; r < bracket.rounds.length; r++) {
      const prev = bracket.rounds[r - 1].games;
      for (let i = 0; i < bracket.rounds[r].games.length; i++) {
        const g = bracket.rounds[r].games[i];
        const t1 = prev[i * 2]?.winner_id;
        const t2 = prev[i * 2 + 1]?.winner_id;
        if (t1 != null) g.team1_id = t1;
        if (t2 != null) g.team2_id = t2;
      }
    }
    // Resolve team names for display
    for (const round of bracket.rounds) {
      for (const g of round.games) {
        if (g.team1_id != null) g.team1_name = teamMap[g.team1_id] ?? `Team #${g.team1_id}`;
        if (g.team2_id != null) g.team2_name = teamMap[g.team2_id] ?? `Team #${g.team2_id}`;
      }
    }
    return NextResponse.json({
      league_id: row.league_id,
      league_name: league.name,
      num_teams: row.num_teams,
      bracket,
      teams,
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch bracket" }, { status: 500 });
  }
}

/** POST: create or reset bracket (admin only). Body: { league_id, num_teams }. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const league_id = parseInt(String(body.league_id ?? ""), 10);
    const num_teams = [4, 8, 16].includes(Number(body.num_teams)) ? Number(body.num_teams) : 8;
    if (!league_id) {
      return NextResponse.json({ error: "league_id required" }, { status: 400 });
    }
    const db = getDb();
    ensureRecLeaguesTables(db);
    const bracket = buildEmptyBracket(num_teams);
    db.prepare(
      `INSERT INTO rec_playoff_brackets (league_id, num_teams, bracket_json, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(league_id) DO UPDATE SET num_teams = ?, bracket_json = ?, updated_at = datetime('now')`
    ).run(league_id, num_teams, JSON.stringify(bracket), num_teams, JSON.stringify(bracket));
    db.close();
    return NextResponse.json({ league_id, num_teams, bracket });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save bracket" }, { status: 500 });
  }
}

/** PATCH: update bracket (admin only). Body: { league_id, bracket } (full bracket_json rounds). */
export async function PATCH(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const league_id = parseInt(String(body.league_id ?? ""), 10);
    const bracket = body.bracket as BracketJson | undefined;
    if (!league_id || !bracket || !Array.isArray(bracket.rounds)) {
      return NextResponse.json({ error: "league_id and bracket.rounds required" }, { status: 400 });
    }
    const db = getDb();
    ensureRecLeaguesTables(db);
    const existing = db.prepare("SELECT num_teams FROM rec_playoff_brackets WHERE league_id = ?").get(league_id) as { num_teams: number } | undefined;
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Bracket not found. POST first with league_id and num_teams." }, { status: 404 });
    }
    db.prepare("UPDATE rec_playoff_brackets SET bracket_json = ?, updated_at = datetime('now') WHERE league_id = ?").run(JSON.stringify(bracket), league_id);
    db.close();
    return NextResponse.json({ league_id, updated: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update bracket" }, { status: 500 });
  }
}
