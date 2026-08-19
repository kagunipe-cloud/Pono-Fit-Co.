import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import {
  markKisiAuditCronRun,
  notifyStaffOfKisiAudit,
  runNightlyKisiAccessAudit,
} from "@/lib/kisi-access-audit";
import { KISI_AUDIT_BATCH_SIZE } from "@/lib/kisi-audit-config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET — 3 AM gym time (via instrumentation): scan active memberships in batches of 25 vs Kisi.
 * Emails staff when mismatches are found. Pass ?force=1 to run manually.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("x-cron-secret") !== secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.KISI_API_KEY?.trim() || !process.env.KISI_GROUP_ID?.trim()) {
    return NextResponse.json({ error: "KISI_API_KEY and KISI_GROUP_ID must be set." }, { status: 500 });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";

  const db = getDb();
  const tz = getAppTimezone(db);

  const disabled = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("kisi_audit_cron_enabled") as { value: string } | undefined;
  if (disabled?.value?.trim() === "0" && !force) {
    db.close();
    return NextResponse.json({
      skipped: true,
      reason: "Kisi audit cron disabled (app_settings kisi_audit_cron_enabled=0).",
    });
  }

  try {
    const result = await runNightlyKisiAccessAudit(db, tz);
    markKisiAuditCronRun(db, tz);
    db.close();

    const emailed = await notifyStaffOfKisiAudit(result);

    return NextResponse.json({
      ok: true,
      forced: force,
      batch_size: KISI_AUDIT_BATCH_SIZE,
      staff_emailed: emailed,
      ...result,
    });
  } catch (err) {
    console.error("[kisi-access-audit cron]", err);
    try {
      db.close();
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: "Nightly Kisi audit failed." }, { status: 503 });
  }
}
