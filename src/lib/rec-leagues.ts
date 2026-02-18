/**
 * Rec Leagues: no gym membership required.
 * - Teams are created once; team admin can enroll in one or more leagues (e.g. Volleyball, Kickball).
 * - Schedule (games) is created by app admin only: date, time, which two teams play.
 * - Team admin can add roster / invite links; members active after waiver.
 */

import { getDb } from "./db";

export function ensureRecLeaguesTables(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rec_leagues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      season TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rec_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_by_member_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  try {
    db.exec("ALTER TABLE rec_teams ADD COLUMN created_by_member_id TEXT");
  } catch {
    /* column already exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS rec_team_league_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES rec_teams(id) ON DELETE CASCADE,
      league_id INTEGER NOT NULL REFERENCES rec_leagues(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(team_id, league_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rec_team_league_enrollments_team ON rec_team_league_enrollments(team_id);
    CREATE INDEX IF NOT EXISTS idx_rec_team_league_enrollments_league ON rec_team_league_enrollments(league_id);

    CREATE TABLE IF NOT EXISTS rec_team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES rec_teams(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      member_id TEXT,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      waiver_signed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(team_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_rec_team_members_team ON rec_team_members(team_id);
    CREATE INDEX IF NOT EXISTS idx_rec_team_members_email ON rec_team_members(email);
  `);
  try {
    db.exec("ALTER TABLE rec_team_members ADD COLUMN first_name TEXT");
  } catch { /* exists */ }
  try {
    db.exec("ALTER TABLE rec_team_members ADD COLUMN last_name TEXT");
  } catch { /* exists */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS rec_team_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES rec_teams(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      email TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rec_team_invites_token ON rec_team_invites(token);
    CREATE INDEX IF NOT EXISTS idx_rec_team_invites_team ON rec_team_invites(team_id);

    CREATE TABLE IF NOT EXISTS rec_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER REFERENCES rec_leagues(id),
      home_team_id INTEGER REFERENCES rec_teams(id),
      away_team_id INTEGER REFERENCES rec_teams(id),
      game_date TEXT NOT NULL,
      game_time TEXT,
      location TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rec_games_league ON rec_games(league_id);
    CREATE INDEX IF NOT EXISTS idx_rec_games_date ON rec_games(game_date);

    CREATE TABLE IF NOT EXISTS rec_waiver_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_member_id INTEGER NOT NULL REFERENCES rec_team_members(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      signed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rec_waiver_tokens_token ON rec_waiver_tokens(token);

    CREATE TABLE IF NOT EXISTS rec_playoff_brackets (
      league_id INTEGER PRIMARY KEY REFERENCES rec_leagues(id) ON DELETE CASCADE,
      num_teams INTEGER NOT NULL DEFAULT 8 CHECK (num_teams IN (4, 8, 16)),
      bracket_json TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  seedDefaultLeagues(db);
}

/** Ensure Volleyball and Kickball leagues exist. */
function seedDefaultLeagues(db: ReturnType<typeof getDb>) {
  for (const name of ["Volleyball", "Kickball"]) {
    const row = db.prepare("SELECT id FROM rec_leagues WHERE name = ?").get(name);
    if (!row) db.prepare("INSERT INTO rec_leagues (name) VALUES (?)").run(name);
  }
}
