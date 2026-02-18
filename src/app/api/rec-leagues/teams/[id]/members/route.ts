import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../../../lib/rec-leagues";
import { getMemberIdFromSession } from "../../../../../../lib/session";

export const dynamic = "force-dynamic";

/** POST: add a member to the team. Body: { first_name, last_name, email }. Team admin only. */
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
    const first_name = (body.first_name ?? "").trim();
    const last_name = (body.last_name ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }
    const db = getDb();
    ensureRecLeaguesTables(db);
    db.exec("PRAGMA foreign_keys = OFF");
    const team = db.prepare("SELECT id, created_by_member_id FROM rec_teams WHERE id = ?").get(teamId) as
      | { id: number; created_by_member_id: string | null }
      | undefined;
    if (!team) {
      db.close();
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    if (team.created_by_member_id !== memberId) {
      db.close();
      return NextResponse.json({ error: "Only the team admin can add members" }, { status: 403 });
    }
    const displayName = [first_name, last_name].filter(Boolean).join(" ") || null;
    db.prepare(
      `INSERT INTO rec_team_members (team_id, email, first_name, last_name, name, role)
       VALUES (?, ?, ?, ?, ?, 'member')`
    ).run(teamId, email, first_name || null, last_name || null, displayName);
    const row = db.prepare(
      "SELECT id, email, first_name, last_name, waiver_signed_at FROM rec_team_members WHERE team_id = ? ORDER BY id DESC LIMIT 1"
    ).get(teamId);
    db.exec("PRAGMA foreign_keys = ON");
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return NextResponse.json({ error: "A member with this email is already on the team" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Failed to add member" },
      { status: 500 }
    );
  }
}
