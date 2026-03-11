import { NextResponse } from "next/server";
import { getDb, expiryDateSortableSql } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { grantAccess as kisiGrantAccess } from "@/lib/kisi";

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
      "SELECT member_id, kisi_id, waiver_signed_at FROM members WHERE member_id = ?"
    ).get(memberId) as { member_id: string; kisi_id: string | null; waiver_signed_at: string | null } | undefined;

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

    const kisiId = row.kisi_id?.trim() || null;
    const expRow = db.prepare(
      `SELECT expiry_date FROM subscriptions WHERE member_id = ? AND status = 'Active' ORDER BY ${expiryDateSortableSql("expiry_date")} DESC LIMIT 1`
    ).get(memberId) as { expiry_date: string } | undefined;
    db.close();

    let kisiGranted = false;
    const expiryDateStr = expRow?.expiry_date?.trim();
    if (kisiId && expiryDateStr) {
      try {
        const expiryDate = new Date(expiryDateStr);
        if (!Number.isNaN(expiryDate.getTime())) {
          await kisiGrantAccess(kisiId, expiryDate);
          kisiGranted = true;
        }
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
