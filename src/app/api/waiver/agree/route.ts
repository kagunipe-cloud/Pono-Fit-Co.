import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getSubscriptionDoorAccessValidUntil } from "@/lib/pass-access";
import { grantAccess as kisiGrantAccess } from "@/lib/kisi";

export const dynamic = "force-dynamic";

/** POST { token } — Record waiver agreement, clear token, grant Kisi if member has access. Public. */
export async function POST(request: NextRequest) {
  let token: string;
  try {
    const body = await request.json();
    token = typeof body?.token === "string" ? body.token.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT member_id, kisi_id, waiver_signed_at FROM members WHERE waiver_token = ? AND waiver_token_expires_at > datetime('now')`
    ).get(token) as { member_id: string; kisi_id: string | null; waiver_signed_at: string | null } | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Invalid or expired link. Request a new one from the gym." }, { status: 401 });
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE members SET waiver_signed_at = ?, waiver_token = NULL, waiver_token_expires_at = NULL WHERE member_id = ?`
    ).run(now, row.member_id);
    const memberId = row.member_id;
    const kisiId = row.kisi_id?.trim() || null;
    const tz = getAppTimezone(db);
    const validUntil = getSubscriptionDoorAccessValidUntil(db, memberId, tz);
    db.close();

    let kisiGranted = false;
    if (kisiId && validUntil && validUntil.getTime() > Date.now()) {
      try {
        await kisiGrantAccess(kisiId, validUntil);
        kisiGranted = true;
      } catch (e) {
        console.error("[waiver/agree] Kisi grant failed for", memberId, e);
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Waiver signed. Door access has been activated.",
      kisi_granted: kisiGranted,
    });
  } catch (err) {
    console.error("[waiver/agree]", err);
    return NextResponse.json({ error: "Failed to record waiver" }, { status: 500 });
  }
}
