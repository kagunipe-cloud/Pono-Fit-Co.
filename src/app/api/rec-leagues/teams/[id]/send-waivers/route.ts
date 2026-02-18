import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getMemberIdFromSession } from "../../../../../../lib/session";
import { getDb } from "../../../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../../../lib/rec-leagues";
import { sendWaiverLinkEmail } from "../../../../../../lib/email";

export const dynamic = "force-dynamic";

const WAIVER_LINK_EXPIRY_DAYS = 30;

/** POST: send waiver links to team members who haven't signed. Team admin only. */
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
  const origin = request.headers.get("origin") ?? request.nextUrl.origin;
  const db = getDb();
  ensureRecLeaguesTables(db);
  const team = db.prepare("SELECT id, name, created_by_member_id FROM rec_teams WHERE id = ?").get(teamId) as
    | { id: number; name: string; created_by_member_id: string | null }
    | undefined;
  if (!team) {
    db.close();
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (team.created_by_member_id !== memberId) {
    db.close();
    return NextResponse.json({ error: "Only the team admin can send waivers" }, { status: 403 });
  }
  const unsigned = db.prepare(
    "SELECT id, email, first_name FROM rec_team_members WHERE team_id = ? AND (waiver_signed_at IS NULL OR waiver_signed_at = '')"
  ).all(teamId) as { id: number; email: string; first_name: string | null }[];
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + WAIVER_LINK_EXPIRY_DAYS);
  const expiresStr = expiresAt.toISOString();
  const insertToken = db.prepare(
    "INSERT INTO rec_waiver_tokens (team_member_id, token, expires_at) VALUES (?, ?, ?)"
  );
  let sent = 0;
  for (const m of unsigned) {
    const token = randomUUID().replace(/-/g, "");
    insertToken.run(m.id, token, expiresStr);
    const waiverUrl = `${origin}/rec-leagues/waiver?token=${encodeURIComponent(token)}`;
    const result = await sendWaiverLinkEmail({
      to: m.email,
      waiver_url: waiverUrl,
      team_name: team.name,
      first_name: m.first_name || null,
    });
    if (result.ok) sent++;
  }
  db.close();
  return NextResponse.json({
    message: sent === 0 && unsigned.length === 0
      ? "Everyone on the roster has already signed."
      : `Waiver link${unsigned.length === 1 ? "" : "s"} sent to ${sent} of ${unsigned.length} member${unsigned.length === 1 ? "" : "s"}.`,
    sent,
    total: unsigned.length,
  });
}
