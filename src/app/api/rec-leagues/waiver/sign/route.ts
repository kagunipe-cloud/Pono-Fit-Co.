import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensureRecLeaguesTables } from "../../../../../lib/rec-leagues";
import { sendWaiverSignedCopyToAdmin } from "../../../../../lib/email";

export const dynamic = "force-dynamic";

/** POST body: { token }. Marks waiver signed and optionally emails admin a copy. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = (body.token ?? "").trim();
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }
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
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    }
    const now = new Date().toISOString();
    if (row.expires_at < now) {
      db.close();
      return NextResponse.json({ error: "This waiver link has expired" }, { status: 400 });
    }
    if (row.signed_at || row.waiver_signed_at) {
      db.close();
      return NextResponse.json({ error: "This waiver has already been signed" }, { status: 400 });
    }
    db.prepare("UPDATE rec_team_members SET waiver_signed_at = ? WHERE id = ?").run(now, row.team_member_id);
    db.prepare("UPDATE rec_waiver_tokens SET signed_at = ? WHERE id = ?").run(now, row.id);
    db.close();
    const memberName = [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email;
    await sendWaiverSignedCopyToAdmin({
      member_name: memberName,
      team_name: row.team_name,
      email: row.email,
      signed_at: now,
    });
    return NextResponse.json({ success: true, message: "Waiver signed. Thank you." });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to sign waiver" }, { status: 500 });
  }
}
