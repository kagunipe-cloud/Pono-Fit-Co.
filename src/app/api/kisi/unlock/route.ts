import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "../../../../lib/db";
import { createLoginForUser, ensureKisiUser, grantAccess, unlockWithUserSecret } from "../../../../lib/kisi";
import { getSubscriptionDoorAccessValidUntil } from "../../../../lib/pass-access";
import { addOccupancyEntry, ensureOccupancyTable } from "../../../../lib/occupancy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const emailProvided = (body.email ?? "").trim();
    const proximityProof = typeof body.proximity_proof === "string" ? body.proximity_proof.trim() : "";
    const lockIdOverride = typeof body.lock_id === "string" ? body.lock_id.trim() : "";
    const latRaw = body.latitude;
    const lonRaw = body.longitude;
    const latitude = typeof latRaw === "number" ? latRaw : typeof latRaw === "string" ? parseFloat(latRaw) : NaN;
    const longitude = typeof lonRaw === "number" ? lonRaw : typeof lonRaw === "string" ? parseFloat(lonRaw) : NaN;
    if (!member_id) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }

    const db = getDb();
    const member = db.prepare(
      "SELECT email, first_name, last_name, kisi_id FROM members WHERE member_id = ?"
    ).get(member_id) as { email: string | null; first_name: string | null; last_name: string | null; kisi_id: string | null } | undefined;
    if (!member?.email?.trim()) {
      db.close();
      return NextResponse.json(
        { error: "Member not found or has no email. Cannot unlock." },
        { status: 400 }
      );
    }
    if (emailProvided && member.email && emailProvided.toLowerCase() !== member.email.toLowerCase()) {
      db.close();
      return NextResponse.json(
        { error: "Email does not match this member." },
        { status: 403 }
      );
    }

    // Ensure Kisi user exists (fixes 404 for complimentary members who weren't granted at signup)
    let kisiId = member.kisi_id?.trim() || null;
    /** True only when we just linked Kisi — grant door role here. Skip on normal unlocks (grantAccess is slow: list + deletes + POST). */
    const needsInitialKisiGrant = !kisiId;
    if (!kisiId) {
      const name = [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || undefined;
      kisiId = await ensureKisiUser(member.email.trim(), name);
      db.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, member_id);
    }
    db.close();

    // One-time grant when we first attach kisi_id. Purchase / waiver / pass activation / complimentary already call grantAccess elsewhere.
    if (needsInitialKisiGrant) {
      try {
        const db2 = getDb();
        const tz = getAppTimezone(db2);
        const validUntil = getSubscriptionDoorAccessValidUntil(db2, member_id, tz);
        db2.close();
        if (validUntil && validUntil.getTime() > Date.now()) {
          await grantAccess(kisiId, validUntil);
        }
      } catch (e) {
        console.warn("[Kisi unlock] grant check failed, continuing:", e);
      }
    }

    const secret = await createLoginForUser(member.email);
    await unlockWithUserSecret(secret, {
      ...(lockIdOverride ? { lockId: lockIdOverride } : {}),
      ...(proximityProof ? { proximityProof } : {}),
      ...(Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {}),
    });

    // Add +1 to coconut count (Kisi may not send webhook for API-triggered unlocks). Dedupes same member within 60 min.
    try {
      const dbOcc = getDb();
      ensureOccupancyTable(dbOcc);
      addOccupancyEntry(dbOcc, "kisi", new Date().toISOString(), member_id);
      dbOcc.close();
    } catch (e) {
      console.warn("[Kisi unlock] occupancy add failed:", e);
    }

    return NextResponse.json({ success: true, message: "Door unlocked." });
  } catch (err) {
    console.error("[Kisi unlock]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unlock failed" },
      { status: 500 }
    );
  }
}
