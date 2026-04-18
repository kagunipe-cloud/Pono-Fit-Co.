import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersDoorAccessWaiverExemptColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { todayInAppTz } from "@/lib/app-timezone";
import { listMemberIdsWithDoorAccessToday, getSubscriptionDoorAccessValidUntil } from "@/lib/pass-access";
import { ensureKisiUser, grantAccess } from "@/lib/kisi";

export const dynamic = "force-dynamic";

const CONFIRM_PHRASE = "LEGACY_DOOR_WAIVER_BYPASS";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST — **Admin, one-time migration** after a bulk cancel (e.g. Glofox) left Kisi out of sync.
 *
 * - Finds everyone who **currently** has in-app door access (same rules as `has_door_access`).
 * - For each: ensures Kisi user, **`grantAccess` to correct `valid_until`**, then sets **`door_access_waiver_exempt = 1`**
 *   so future renewals/checkout can grant Kisi **without** `waiver_signed_at`. New members keep `0` unless you run this again.
 *
 * Body:
 * - `{ "dry_run": true }` — count + sample IDs only (no Kisi, no DB updates).
 * - `{ "confirm": "LEGACY_DOOR_WAIVER_BYPASS" }` — run for real (optional `dry_run: false`).
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { dry_run?: boolean; confirm?: string };
  try {
    body = (await request.json()) as { dry_run?: boolean; confirm?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dryRun = body.dry_run === true;
  if (!dryRun && String(body.confirm ?? "").trim() !== CONFIRM_PHRASE) {
    return NextResponse.json(
      {
        error: `Run with dry_run: true first. To execute, send confirm: "${CONFIRM_PHRASE}".`,
      },
      { status: 400 }
    );
  }

  const db = getDb();
  ensureMembersDoorAccessWaiverExemptColumn(db);
  const tz = getAppTimezone(db);
  const todayYmd = todayInAppTz(tz);
  const memberIds = listMemberIdsWithDoorAccessToday(db, todayYmd);
  db.close();

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      timezone: tz,
      date: todayYmd,
      count: memberIds.length,
      member_ids_sample: memberIds.slice(0, 40),
    });
  }

  const granted: string[] = [];
  const skipped_no_email: string[] = [];
  const skipped_no_valid_until: string[] = [];
  const errors: { member_id: string; message: string }[] = [];

  for (const member_id of memberIds) {
    const dbLoop = getDb();
    ensureMembersDoorAccessWaiverExemptColumn(dbLoop);
    const row = dbLoop
      .prepare("SELECT email, first_name, last_name, kisi_id FROM members WHERE member_id = ?")
      .get(member_id) as {
        email: string | null;
        first_name: string | null;
        last_name: string | null;
        kisi_id: string | null;
      } | undefined;
    if (!row) {
      dbLoop.close();
      await sleep(20);
      continue;
    }
    const emailTrim = row.email?.trim();
    if (!emailTrim) {
      skipped_no_email.push(member_id);
      dbLoop.close();
      await sleep(20);
      continue;
    }

    let kisiId = row.kisi_id?.trim() || null;
    if (!kisiId) {
      try {
        const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || undefined;
        kisiId = await ensureKisiUser(emailTrim, name);
        dbLoop.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, member_id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ member_id, message: `ensureKisiUser: ${message}` });
        dbLoop.close();
        await sleep(200);
        continue;
      }
    }

    const tzLoop = getAppTimezone(dbLoop);
    const validUntil = getSubscriptionDoorAccessValidUntil(dbLoop, member_id, tzLoop);
    dbLoop.close();

    if (!validUntil || validUntil.getTime() <= Date.now()) {
      skipped_no_valid_until.push(member_id);
      await sleep(20);
      continue;
    }

    try {
      await grantAccess(kisiId, validUntil);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ member_id, message: `grantAccess: ${message}` });
      await sleep(200);
      continue;
    }

    const dbMark = getDb();
    ensureMembersDoorAccessWaiverExemptColumn(dbMark);
    dbMark.prepare("UPDATE members SET door_access_waiver_exempt = 1 WHERE member_id = ?").run(member_id);
    dbMark.close();
    granted.push(member_id);
    await sleep(200);
  }

  return NextResponse.json({
    ok: true,
    timezone: tz,
    date: todayYmd,
    total_eligible: memberIds.length,
    granted_count: granted.length,
    granted_member_ids_sample: granted.slice(0, 40),
    skipped_no_email,
    skipped_no_valid_until,
    errors,
  });
}
