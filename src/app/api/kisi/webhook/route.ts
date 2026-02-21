import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getDb } from "../../../../lib/db";
import { ensureUsageTables } from "../../../../lib/usage";

export const dynamic = "force-dynamic";

type KisiUnlockPayload = {
  uuid?: string;
  actor_type?: string | null;
  actor_id?: number;
  actor_name?: string | null;
  object_type?: string;
  object_id?: number;
  object_name?: string | null;
  success?: boolean;
  type?: string;
  created_at?: string;
};

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.KISI_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return expected.length === signatureHeader.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signatureHeader, "hex"));
  } catch {
    return false;
  }
}

/** Kisi sends HMAC-SHA256 of body in X-Signature (hex). Optional: set KISI_WEBHOOK_SECRET to verify. */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-signature") ?? request.headers.get("X-Signature") ?? null;
    if (process.env.KISI_WEBHOOK_SECRET?.trim() && !verifySignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as KisiUnlockPayload;
    if (body.type !== "lock.unlock") {
      return NextResponse.json({ ok: true, ignored: "not lock.unlock" });
    }

    const uuid = (body.uuid ?? "").trim() || null;
    if (!uuid) {
      return NextResponse.json({ error: "Missing uuid" }, { status: 400 });
    }

    const db = getDb();
    ensureUsageTables(db);

    const existing = db.prepare("SELECT 1 FROM door_access_events WHERE uuid = ?").get(uuid);
    if (existing) {
      db.close();
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const kisiActorId = body.actor_type === "User" && body.actor_id != null ? body.actor_id : null;
    let memberId: string | null = null;
    if (kisiActorId != null) {
      const row = db.prepare("SELECT member_id FROM members WHERE kisi_id = ? OR kisi_id = ?").get(String(kisiActorId), kisiActorId) as { member_id: string } | undefined;
      memberId = row?.member_id ?? null;
    }

    const happenedAt = (body.created_at ?? new Date().toISOString()).trim();
    db.prepare(
      `INSERT INTO door_access_events (uuid, member_id, kisi_actor_id, kisi_actor_name, lock_id, lock_name, success, happened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuid,
      memberId,
      kisiActorId ?? null,
      (body.actor_name ?? "") || null,
      body.object_id ?? null,
      (body.object_name ?? "") || null,
      body.success === true ? 1 : 0,
      happenedAt
    );
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Kisi webhook]", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
