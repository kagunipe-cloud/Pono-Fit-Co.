import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { getSubscriptionDoorAccessValidUntil, endOfCalendarDayInTimeZone } from "@/lib/pass-access";
import { findKisiUserByEmail, grantAccess } from "@/lib/kisi";

export const dynamic = "force-dynamic";

const SETTINGS_KEY = "migration_kisi_grace_until";

function parseGraceYmd(s: string): string | null {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

/**
 * GET — Admin: migration Kisi grant instructions and last saved grace date (if any).
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let savedGraceUntil: string | null = null;
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    db.close();
    savedGraceUntil = row?.value?.trim() || null;
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    description:
      "Migration: extend Kisi door access for members with an active door subscription in this app. " +
      "Computes valid_until = min(end of grace day in app timezone, subscription door-access end). " +
      "By default uses members.kisi_id only. Set lookup_kisi_by_email: true to resolve Kisi users by email " +
      "(e.g. Glofox-created users not yet stored in the app), then grant and save kisi_id. " +
      "Does not change waiver_signed_at.",
    saved_grace_until: savedGraceUntil,
    usage: {
      method: "POST",
      body: {
        grace_until: "YYYY-MM-DD — last calendar day of the grace window (required)",
        dry_run: "optional boolean — if true, only counts; no Kisi API calls",
        lookup_kisi_by_email:
          "optional boolean — if true, iterate members with email, look up Kisi by email when kisi_id missing, grant, backfill kisi_id (default false)",
      },
    },
  });
}

type MemberRow = { member_id: string; kisi_id: string | null; email: string | null };

/**
 * POST — Admin: run migration Kisi grant for all eligible members.
 * Body: { grace_until, dry_run?, lookup_kisi_by_email? }
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { grace_until?: string; dry_run?: boolean; lookup_kisi_by_email?: boolean };
  try {
    body = (await request.json()) as { grace_until?: string; dry_run?: boolean; lookup_kisi_by_email?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const graceYmd = parseGraceYmd(String(body.grace_until ?? ""));
  if (!graceYmd) {
    return NextResponse.json(
      { error: "grace_until is required and must be YYYY-MM-DD (last day of grace window)." },
      { status: 400 }
    );
  }

  const dryRun = body.dry_run === true;
  const lookupKisiByEmail = body.lookup_kisi_by_email === true;
  const kisiConfigured = !!(process.env.KISI_API_KEY?.trim() && process.env.KISI_GROUP_ID?.trim());
  if (!dryRun && !kisiConfigured) {
    return NextResponse.json(
      { error: "KISI_API_KEY and KISI_GROUP_ID must be set in the environment to grant Kisi access." },
      { status: 500 }
    );
  }

  const db = getDb();
  const tz = getAppTimezone(db);
  const graceEnd = endOfCalendarDayInTimeZone(graceYmd, tz);
  if (Number.isNaN(graceEnd.getTime())) {
    db.close();
    return NextResponse.json({ error: "Invalid grace_until date." }, { status: 400 });
  }

  const rows = (
    lookupKisiByEmail
      ? db
          .prepare(
            `SELECT member_id, kisi_id, email FROM members
             WHERE email IS NOT NULL AND TRIM(email) != ''`
          )
          .all()
      : db
          .prepare(
            `SELECT member_id, kisi_id, email FROM members
             WHERE kisi_id IS NOT NULL AND TRIM(kisi_id) != ''`
          )
          .all()
  ) as MemberRow[];

  const now = new Date();
  const errors: { member_id: string; email?: string; error: string }[] = [];
  let skipped_no_active_sub = 0;
  let skipped_expired = 0;
  let skipped_not_in_kisi = 0;
  let granted = 0;
  let kisi_id_backfilled = 0;
  let dry_run_eligible_without_stored_kisi = 0;
  /** Space out Kisi calls (list/delete/grant per member; email lookup adds a GET when resolving). */
  let kisiGrantAttempt = 0;

  for (const row of rows) {
    const subUntil = getSubscriptionDoorAccessValidUntil(db, row.member_id, tz);
    if (!subUntil) {
      skipped_no_active_sub++;
      continue;
    }
    const validUntil = subUntil.getTime() < graceEnd.getTime() ? subUntil : graceEnd;
    if (validUntil.getTime() <= now.getTime()) {
      skipped_expired++;
      continue;
    }

    const emailTrim = row.email?.trim() ?? "";
    const storedKisi = row.kisi_id?.trim() ?? "";

    if (dryRun) {
      granted++;
      if (lookupKisiByEmail && !storedKisi) {
        dry_run_eligible_without_stored_kisi++;
      }
      continue;
    }

    let resolvedKisi: string | null = null;
    if (lookupKisiByEmail && emailTrim) {
      resolvedKisi = (await findKisiUserByEmail(emailTrim)) ?? (storedKisi || null);
    } else {
      resolvedKisi = storedKisi || null;
    }

    if (!resolvedKisi) {
      skipped_not_in_kisi++;
      continue;
    }

    try {
      if (kisiGrantAttempt > 0) {
        await new Promise((r) => setTimeout(r, 400));
      }
      kisiGrantAttempt++;
      await grantAccess(resolvedKisi, validUntil);
      granted++;
      if (lookupKisiByEmail && (!storedKisi || storedKisi !== resolvedKisi)) {
        try {
          db.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(resolvedKisi, row.member_id);
          kisi_id_backfilled++;
        } catch (ue) {
          console.error("[migration-grant-kisi] kisi_id backfill failed:", row.member_id, ue);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ member_id: row.member_id, ...(emailTrim ? { email: emailTrim } : {}), error: msg });
    }
  }

  if (!dryRun) {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(SETTINGS_KEY, graceYmd);
  }
  db.close();

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    lookup_kisi_by_email: lookupKisiByEmail,
    grace_until: graceYmd,
    grace_end_iso: graceEnd.toISOString(),
    timezone: tz,
    members_in_scope: rows.length,
    members_with_kisi_id: rows.length,
    granted,
    skipped_no_active_sub,
    skipped_expired,
    skipped_not_in_kisi: lookupKisiByEmail ? skipped_not_in_kisi : undefined,
    kisi_id_backfilled: lookupKisiByEmail && !dryRun ? kisi_id_backfilled : undefined,
    dry_run_eligible_without_stored_kisi: dryRun && lookupKisiByEmail ? dry_run_eligible_without_stored_kisi : undefined,
    errors: errors.length ? errors : undefined,
    saved_grace_to_app_settings: dryRun ? false : SETTINGS_KEY,
  });
}
