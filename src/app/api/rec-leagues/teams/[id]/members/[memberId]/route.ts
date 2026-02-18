import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureRecLeaguesTables } from "@/lib/rec-leagues";
import { getMemberIdFromSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** DELETE: remove a member from the team. Team admin only. Cannot remove the last admin. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const sessionMemberId = await getMemberIdFromSession();
  if (!sessionMemberId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const teamId = parseInt((await params).id, 10);
  const rosterMemberId = parseInt((await params).memberId, 10);
  if (Number.isNaN(teamId) || Number.isNaN(rosterMemberId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const db = getDb();
    ensureRecLeaguesTables(db);
    const team = db.prepare("SELECT id, created_by_member_id FROM rec_teams WHERE id = ?").get(teamId) as
      | { id: number; created_by_member_id: string | null }
      | undefined;
    if (!team) {
      db.close();
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    if (team.created_by_member_id !== sessionMemberId) {
      db.close();
      return NextResponse.json({ error: "Only the team admin can remove members" }, { status: 403 });
    }
    const row = db.prepare("SELECT id, role FROM rec_team_members WHERE id = ? AND team_id = ?").get(rosterMemberId, teamId) as
      | { id: number; role: string }
      | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Member not found on this team" }, { status: 404 });
    }
    if (row.role === "admin") {
      const adminCount = db.prepare("SELECT COUNT(*) AS n FROM rec_team_members WHERE team_id = ? AND role = 'admin'").get(teamId) as { n: number };
      if (adminCount.n <= 1) {
        db.close();
        return NextResponse.json({ error: "Cannot remove the only admin from the team" }, { status: 400 });
      }
    }
    db.prepare("DELETE FROM rec_team_members WHERE id = ? AND team_id = ?").run(rosterMemberId, teamId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}

/** PATCH: update a roster member's first_name, last_name, email. Team admin only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const sessionMemberId = await getMemberIdFromSession();
  if (!sessionMemberId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const teamId = parseInt((await params).id, 10);
  const rosterMemberId = parseInt((await params).memberId, 10);
  if (Number.isNaN(teamId) || Number.isNaN(rosterMemberId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const first_name = (body.first_name ?? "").trim() || null;
    const last_name = (body.last_name ?? "").trim() || null;
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
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
    if (team.created_by_member_id !== sessionMemberId) {
      db.close();
      return NextResponse.json({ error: "Only the team admin can edit members" }, { status: 403 });
    }
    const existing = db.prepare("SELECT id FROM rec_team_members WHERE id = ? AND team_id = ?").get(rosterMemberId, teamId);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Member not found on this team" }, { status: 404 });
    }
    const displayName = [first_name, last_name].filter(Boolean).join(" ") || null;
    db.prepare(
      "UPDATE rec_team_members SET first_name = ?, last_name = ?, name = ?, email = ? WHERE id = ? AND team_id = ?"
    ).run(first_name, last_name, displayName, email, rosterMemberId, teamId);
    const row = db.prepare(
      "SELECT id, email, first_name, last_name, name, role, waiver_signed_at FROM rec_team_members WHERE id = ?"
    ).get(rosterMemberId);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return NextResponse.json({ error: "A member with this email is already on the team" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
  }
}
