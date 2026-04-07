import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { getSubscriptionDoorAccessValidUntil, endOfCalendarDayInTimeZone } from "@/lib/pass-access";
import { grantAccess } from "@/lib/kisi";

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
      "Migration: extend Kisi door access for members who already have a Kisi user (kisi_id) and an active membership in this app. " +
      "Computes valid_until = min(end of grace day in app timezone, subscription door-access end). " +
      "Does not change waiver_signed_at. App waiver flow stays strict (WaiverGate unchanged).",
    saved_grace_until: savedGraceUntil,
    usage: {
      method: "POST",
      body: {
        grace_until: "YYYY-MM-DD — last calendar day of the grace window (required)",
        dry_run: "optional boolean — if true, only counts who would be granted; no Kisi API calls",
      },
    },
  });
}

/**
 * POST — Admin: run migration Kisi grant for all eligible members.
 * Body: { grace_until: string (YYYY-MM-DD), dry_run?: boolean }
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { grace_until?: string; dry_run?: boolean };
  try {
    body = (await request.json()) as { grace_until?: string; dry_run?: boolean };
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

  const now = new Date();
  const rows = db
    .prepare(
      `SELECT member_id, kisi_id FROM members
       WHERE kisi_id IS NOT NULL AND TRIM(kisi_id) != ''`
    )
    .all() as { member_id: string; kisi_id: string }[];

  const errors: { member_id: string; error: string }[] = [];
  let skipped_no_active_sub = 0;
  let skipped_expired = 0;
  let granted = 0;

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

    if (dryRun) {
      granted++;
      continue;
    }

    try {
      await grantAccess(row.kisi_id.trim(), validUntil);
      granted++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ member_id: row.member_id, error: msg });
    }
  }

  if (!dryRun) {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(SETTINGS_KEY, graceYmd);
  }
  db.close();

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    grace_until: graceYmd,
    grace_end_iso: graceEnd.toISOString(),
    timezone: tz,
    members_with_kisi_id: rows.length,
    granted,
    skipped_no_active_sub,
    skipped_expired,
    errors: errors.length ? errors : undefined,
    saved_grace_to_app_settings: dryRun ? false : SETTINGS_KEY,
  });
}
