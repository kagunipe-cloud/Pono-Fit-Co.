import { NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { getSubscriptionDoorAccessValidUntil } from "@/lib/pass-access";
import { ensureKisiUser, grantAccess as kisiGrantAccess } from "@/lib/kisi";

export const dynamic = "force-dynamic";

/** POST — Record waiver agreement for the logged-in member. No token or email needed. */
export async function POST() {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT member_id, kisi_id, waiver_signed_at, email, first_name, last_name FROM members WHERE member_id = ?"
    ).get(memberId) as {
      member_id: string;
      kisi_id: string | null;
      waiver_signed_at: string | null;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    } | undefined;

    if (!row) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if ((row.waiver_signed_at ?? "").trim()) {
      db.close();
      return NextResponse.json({ ok: true, message: "You have already signed the waiver.", already_signed: true });
    }

    const now = new Date().toISOString();
    db.prepare(
      "UPDATE members SET waiver_signed_at = ?, waiver_token = NULL, waiver_token_expires_at = NULL WHERE member_id = ?"
    ).run(now, memberId);

    const tz = getAppTimezone(db);
    const validUntil = getSubscriptionDoorAccessValidUntil(db, memberId, tz);

    let kisiId = row.kisi_id?.trim() || null;
    const emailTrim = row.email?.trim();
    if (!kisiId && emailTrim && validUntil && validUntil.getTime() > Date.now()) {
      try {
        const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || undefined;
        kisiId = await ensureKisiUser(emailTrim, name);
        db.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, memberId);
      } catch (e) {
        console.error("[waiver/agree-session] ensureKisiUser failed for", memberId, e);
      }
    }
    db.close();

    let kisiGranted = false;
    if (kisiId && validUntil && validUntil.getTime() > Date.now()) {
      try {
        await kisiGrantAccess(kisiId, validUntil);
        kisiGranted = true;
      } catch (e) {
        console.error("[waiver/agree-session] Kisi grant failed for", memberId, e);
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Waiver signed. Door access has been activated.",
      kisi_granted: kisiGranted,
    });
  } catch (err) {
    console.error("[waiver/agree-session]", err);
    return NextResponse.json({ error: "Failed to record waiver" }, { status: 500 });
  }
}
