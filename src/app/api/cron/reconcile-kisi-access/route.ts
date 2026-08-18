import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import {
  KISI_RECONCILE_INTERVAL_DAYS,
  listMemberIdsForKisiReconcile,
  markKisiReconcileRun,
  notifyStaffOfKisiReconcile,
  reconcileKisiDoorAccess,
  shouldRunKisiReconcileCron,
} from "@/lib/kisi-access-reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET — Every few days: scan members with app door access today; re-grant Kisi when role is missing/expired.
 * Runs at most once per KISI_RECONCILE_INTERVAL_DAYS (default 3). Pass ?force=1 to run anyway (admin/cron debug).
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
    .get("kisi_reconcile_cron_enabled") as { value: string } | undefined;
  if (disabled?.value?.trim() === "0" && !force) {
    db.close();
    return NextResponse.json({
      skipped: true,
      reason: "Kisi reconcile cron disabled (app_settings kisi_reconcile_cron_enabled=0).",
    });
  }

  const schedule = shouldRunKisiReconcileCron(db, tz);
  if (!force && !schedule.run) {
    db.close();
    return NextResponse.json({
      skipped: true,
      reason: schedule.reason,
      last_run_ymd: schedule.last_run_ymd,
      interval_days: KISI_RECONCILE_INTERVAL_DAYS,
    });
  }

  const memberIds = listMemberIdsForKisiReconcile(db, tz);
  const result = await reconcileKisiDoorAccess(db, tz, memberIds);
  markKisiReconcileRun(db, tz);
  db.close();

  const emailed = await notifyStaffOfKisiReconcile(result);

  return NextResponse.json({
    ok: true,
    forced: force,
    interval_days: KISI_RECONCILE_INTERVAL_DAYS,
    staff_emailed: emailed,
    ...result,
  });
}
