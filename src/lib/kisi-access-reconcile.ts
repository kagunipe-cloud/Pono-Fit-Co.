import type { getDb } from "./db";
import { ensureMembersDoorAccessWaiverExemptColumn } from "./db";
import { getSubscriptionDoorAccessValidUntil, listMemberIdsWithDoorAccessToday } from "./pass-access";
import { todayInAppTz, addDaysToDateStr } from "./app-timezone";
import { ensureKisiUser, grantAccess } from "./kisi";
import { ensureWaiverBeforeKisi } from "./waiver";
import { sendStaffEmail } from "./email";
import { auditOneMemberKisiAccess, type KisiAccessSyncStatus } from "./kisi-access-audit";

export const KISI_RECONCILE_LAST_RUN_KEY = "kisi_reconcile_last_ymd";
export const KISI_RECONCILE_INTERVAL_DAYS = 3;

export const FIXABLE_KISI_SYNC_STATUSES: KisiAccessSyncStatus[] = [
  "missing_kisi_user",
  "missing_role",
  "expired_role",
];

type MemberAuditRow = {
  member_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  kisi_id: string | null;
  waiver_signed_at: string | null;
  door_access_waiver_exempt: number | null;
  pass_activation_day: string | null;
};

export type KisiReconcileMemberResult =
  | { outcome: "already_ok" }
  | { outcome: "fixed"; kisi_id: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; error: string };

export type KisiReconcileBatchResult = {
  today_ymd: string;
  scanned: number;
  already_ok: number;
  fixed: { member_id: string; email: string | null; kisi_id: string }[];
  skipped: { member_id: string; reason: string }[];
  errors: { member_id: string; error: string }[];
};

function loadMemberAuditRow(db: ReturnType<typeof getDb>, memberId: string): MemberAuditRow | undefined {
  return db
    .prepare(
      `SELECT member_id, email, first_name, last_name, kisi_id, waiver_signed_at,
              door_access_waiver_exempt, pass_activation_day
       FROM members WHERE member_id = ?`
    )
    .get(memberId) as MemberAuditRow | undefined;
}

export function shouldRunKisiReconcileCron(db: ReturnType<typeof getDb>, tz: string, intervalDays = KISI_RECONCILE_INTERVAL_DAYS): {
  run: boolean;
  reason?: string;
  last_run_ymd: string | null;
} {
  const today = todayInAppTz(tz);
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(KISI_RECONCILE_LAST_RUN_KEY) as
    | { value: string }
    | undefined;
  const last = row?.value?.trim() || null;
  if (!last) return { run: true, last_run_ymd: null };
  const nextDue = addDaysToDateStr(last, intervalDays);
  if (today < nextDue) {
    return {
      run: false,
      reason: `Last reconcile was ${last}; next due ${nextDue}.`,
      last_run_ymd: last,
    };
  }
  return { run: true, last_run_ymd: last };
}

export function markKisiReconcileRun(db: ReturnType<typeof getDb>, tz: string) {
  const today = todayInAppTz(tz);
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(KISI_RECONCILE_LAST_RUN_KEY, today);
}

export async function fixMemberKisiAccessIfNeeded(
  db: ReturnType<typeof getDb>,
  tz: string,
  memberId: string
): Promise<KisiReconcileMemberResult> {
  ensureMembersDoorAccessWaiverExemptColumn(db);
  const row = loadMemberAuditRow(db, memberId);
  if (!row) return { outcome: "skipped", reason: "Member not found" };

  const audit = await auditOneMemberKisiAccess(db, tz, row, { lookupKisiByEmail: true });
  if (audit.sync_status === "in_sync") return { outcome: "already_ok" };
  if (!FIXABLE_KISI_SYNC_STATUSES.includes(audit.sync_status)) {
    return { outcome: "skipped", reason: `Not auto-fixable (${audit.sync_status})` };
  }

  const validUntil = getSubscriptionDoorAccessValidUntil(db, memberId, tz);
  if (!validUntil || validUntil.getTime() <= Date.now()) {
    return { outcome: "skipped", reason: "No active door access window in app" };
  }

  const waiver = await ensureWaiverBeforeKisi(memberId, { email: row.email, first_name: row.first_name }, "");
  if (!waiver.shouldGrantKisi) {
    return { outcome: "skipped", reason: "Waiver not signed" };
  }

  const email = row.email?.trim();
  if (!email) return { outcome: "skipped", reason: "No email on profile" };

  try {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || undefined;
    const kisiId = await ensureKisiUser(email, name);
    db.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, memberId);
    await grantAccess(kisiId, validUntil);
    return { outcome: "fixed", kisi_id: kisiId };
  } catch (e) {
    return { outcome: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function reconcileKisiDoorAccess(
  db: ReturnType<typeof getDb>,
  tz: string,
  memberIds: string[],
  options?: { delay_ms?: number }
): Promise<KisiReconcileBatchResult> {
  const delayMs = options?.delay_ms ?? 350;
  const today_ymd = todayInAppTz(tz);
  const fixed: KisiReconcileBatchResult["fixed"] = [];
  const skipped: KisiReconcileBatchResult["skipped"] = [];
  const errors: KisiReconcileBatchResult["errors"] = [];
  let already_ok = 0;

  for (let i = 0; i < memberIds.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const memberId = memberIds[i]!;
    const result = await fixMemberKisiAccessIfNeeded(db, tz, memberId);
    const row = loadMemberAuditRow(db, memberId);
    if (result.outcome === "already_ok") already_ok++;
    else if (result.outcome === "fixed") {
      fixed.push({ member_id: memberId, email: row?.email?.trim() || null, kisi_id: result.kisi_id });
    } else if (result.outcome === "skipped") {
      skipped.push({ member_id: memberId, reason: result.reason });
    } else {
      errors.push({ member_id: memberId, error: result.error });
    }
  }

  return { today_ymd, scanned: memberIds.length, already_ok, fixed, skipped, errors };
}

/** Members who should have door access today (same rules as member/me hasAccess). */
export function listMemberIdsForKisiReconcile(db: ReturnType<typeof getDb>, tz: string): string[] {
  const today = todayInAppTz(tz);
  return listMemberIdsWithDoorAccessToday(db, today);
}

export async function notifyStaffOfKisiReconcile(result: KisiReconcileBatchResult): Promise<boolean> {
  if (result.fixed.length === 0 && result.errors.length === 0) return false;
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || "";
  const auditLink = base ? `${base}/admin/kisi-access-audit` : "/admin/kisi-access-audit";
  const lines = [
    `Kisi door access reconcile (${result.today_ymd})`,
    "",
    `Scanned: ${result.scanned} members with app door access today`,
    `Already OK: ${result.already_ok}`,
    `Fixed (re-granted): ${result.fixed.length}`,
    `Errors: ${result.errors.length}`,
    "",
  ];
  if (result.fixed.length) {
    lines.push("Fixed:");
    for (const f of result.fixed.slice(0, 25)) {
      lines.push(`- ${f.email ?? f.member_id} (kisi_id ${f.kisi_id})`);
    }
    if (result.fixed.length > 25) lines.push(`… and ${result.fixed.length - 25} more`);
    lines.push("");
  }
  if (result.errors.length) {
    lines.push("Errors (need manual check):");
    for (const e of result.errors.slice(0, 15)) {
      lines.push(`- ${e.member_id}: ${e.error}`);
    }
    lines.push("");
  }
  lines.push(`Audit page: ${auditLink}`);
  lines.push("");
  lines.push(
    "Common cause: grantAccess revokes the old Kisi role first; if the new POST fails (429, timeout), the member is paid in the app but has no door role until reconcile fixes it."
  );
  return sendStaffEmail(
    `Kisi reconcile: ${result.fixed.length} fixed, ${result.errors.length} errors`,
    lines.join("\n")
  );
}
