import type { getDb } from "./db";
import { WEEKLY_GOALS_BOARD_ACCESS_LEVEL } from "./db";
import {
  getSubscriptionDoorAccessValidUntil,
  listMemberIdsActiveDoorMembershipInApp,
  memberHasDoorAccessToday,
} from "./pass-access";
import { todayInAppTz, normalizeDateToYMD } from "./app-timezone";
import { findKisiUserByEmail, getKisiUserById, listRoleAssignmentsForUser, pickActiveDoorGroupAssignment } from "./kisi";

export type KisiAccessSyncStatus =
  | "in_sync"
  | "missing_kisi_user"
  | "missing_role"
  | "expired_role"
  | "waiver_blocked"
  | "no_email"
  | "app_no_access_has_kisi"
  | "pass_not_activated";

export type KisiAccessAuditRow = {
  member_id: string;
  email: string | null;
  name: string | null;
  kisi_id: string | null;
  app_has_door_access_today: boolean;
  active_membership_in_app: boolean;
  app_valid_until_iso: string | null;
  waiver_signed: boolean;
  waiver_exempt: boolean;
  open_payment_failures: number;
  subscription_summary: string;
  kisi_has_active_role: boolean;
  kisi_valid_until_iso: string | null;
  sync_status: KisiAccessSyncStatus;
  likely_causes: string[];
};

type MemberAuditBase = {
  member_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  kisi_id: string | null;
  waiver_signed_at: string | null;
  door_access_waiver_exempt: number | null;
  pass_activation_day: string | null;
};

export type KisiAuditScope = "active_in_app" | "all";

/**
 * Who to include in the audit list — determined from **our app only** (Active memberships),
 * then each person is compared to Kisi. Never derived from Kisi membership.
 */
export function listMemberIdsForKisiAuditScope(db: ReturnType<typeof getDb>, tz: string): string[] {
  return listMemberIdsActiveDoorMembershipInApp(db, todayInAppTz(tz));
}

function loadMemberAuditRows(db: ReturnType<typeof getDb>, memberIds: string[]): MemberAuditBase[] {
  if (memberIds.length === 0) return [];
  const placeholders = memberIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT member_id, email, first_name, last_name, kisi_id, waiver_signed_at,
              door_access_waiver_exempt, pass_activation_day
       FROM members WHERE member_id IN (${placeholders})
       ORDER BY member_id ASC`
    )
    .all(...memberIds) as MemberAuditBase[];
}

export function countMembersForKisiAudit(
  db: ReturnType<typeof getDb>,
  tz: string,
  scope: KisiAuditScope = "active_in_app"
): number {
  if (scope === "all") {
    const row = db
      .prepare(`SELECT COUNT(*) as c FROM members WHERE email IS NOT NULL AND TRIM(email) != ''`)
      .get() as { c: number };
    return row?.c ?? 0;
  }
  return listMemberIdsForKisiAuditScope(db, tz).length;
}

function memberDisplayName(row: MemberAuditBase): string | null {
  const name = [row.first_name?.trim(), row.last_name?.trim()].filter(Boolean).join(" ");
  return name || null;
}

function waiverOk(row: MemberAuditBase): boolean {
  return !!row.waiver_signed_at?.trim() || Number(row.door_access_waiver_exempt) === 1;
}

function loadMemberSubscriptions(db: ReturnType<typeof getDb>, memberId: string) {
  return db
    .prepare(
      `SELECT s.status, s.expiry_date, s.start_date, s.subscription_pause_started,
              s.pass_credits_remaining, s.pass_activation_day,
              p.plan_name, p.unit, p.access_level
       FROM subscriptions s
       JOIN membership_plans p ON p.product_id = s.product_id
       WHERE s.member_id = ?
       ORDER BY s.status ASC, s.expiry_date DESC`
    )
    .all(memberId) as Array<Record<string, unknown>>;
}

function subscriptionSummary(subs: Array<Record<string, unknown>>, todayYmd: string): string {
  const active = subs.filter((s) => s.status === "Active");
  if (active.length === 0) return "No active subscription";
  const parts = active.slice(0, 2).map((s) => {
    const name = String(s.plan_name ?? "Membership");
    const level = String(s.access_level ?? "").trim();
    const paused = String(s.subscription_pause_started ?? "").trim();
    const pc = s.pass_credits_remaining;
    if (pc != null && Number(pc) >= 0) {
      const act = String(s.pass_activation_day ?? "").trim();
      return `${name} (pass pack${act === todayYmd ? ", active today" : ", not activated today"})`;
    }
    if (level === WEEKLY_GOALS_BOARD_ACCESS_LEVEL) return `${name} (goal board — no door)`;
    if (paused) return `${name} (paused)`;
    const start = normalizeDateToYMD(String(s.start_date ?? ""));
    if (start && start > todayYmd) return `${name} (starts ${start})`;
    return `${name} (exp ${String(s.expiry_date ?? "?")})`;
  });
  return parts.join("; ");
}

function doorAccessFromNonGoalBoardSub(
  subs: Array<Record<string, unknown>>,
  todayYmd: string,
  memberPassActivationDay?: string | null
): boolean {
  if (String(memberPassActivationDay ?? "").trim() === todayYmd) return true;
  return subs.some((s) => {
    if (s.status !== "Active") return false;
    if (String(s.access_level ?? "").trim() === WEEKLY_GOALS_BOARD_ACCESS_LEVEL) return false;
    const pc = s.pass_credits_remaining;
    if (pc != null && Number(pc) >= 0) {
      return String(s.pass_activation_day ?? "").trim() === todayYmd;
    }
    if (String(s.subscription_pause_started ?? "").trim() !== "") return false;
    const start = normalizeDateToYMD(String(s.start_date ?? ""));
    if (start && start > todayYmd) return false;
    const exp = normalizeDateToYMD(String(s.expiry_date ?? ""));
    return !!exp && exp >= todayYmd;
  });
}

function buildLikelyCauses(params: {
  row: MemberAuditBase;
  subs: Array<Record<string, unknown>>;
  todayYmd: string;
  appHasDoor: boolean;
  kisiHasRole: boolean;
  openFailures: number;
  resolvedKisiId: string | null;
}): string[] {
  const causes: string[] = [];
  const { row, subs, todayYmd, appHasDoor, kisiHasRole, openFailures, resolvedKisiId } = params;

  if (!appHasDoor && kisiHasRole) {
    causes.push("Kisi still has an active role but app says no door access today (expired/cancelled/paused in app).");
    return causes;
  }
  if (!appHasDoor) return causes;

  if (!waiverOk(row)) {
    causes.push("Liability waiver not signed — checkout/renewal skips Kisi grant until waiver is complete.");
  }
  if (!row.email?.trim()) {
    causes.push("No email on member profile — app cannot create or link a Kisi user.");
  }
  if (!resolvedKisiId) {
    causes.push("No Kisi user linked (members.kisi_id empty and no Kisi account found by email).");
  } else if (!row.kisi_id?.trim()) {
    causes.push("Kisi user exists by email but members.kisi_id was never saved.");
  }

  const passOnly = subs.some(
    (s) => s.status === "Active" && s.pass_credits_remaining != null && Number(s.pass_credits_remaining) >= 0
  );
  const passActiveToday = subs.some(
    (s) =>
      s.status === "Active" &&
      s.pass_credits_remaining != null &&
      String(s.pass_activation_day ?? "").trim() === todayYmd
  );
  if (passOnly && !passActiveToday && String(row.pass_activation_day ?? "").trim() !== todayYmd) {
    causes.push("Pass pack member has not activated a day for today — must tap Activate pass for today.");
  }

  if (openFailures > 0) {
    causes.push("Open payment failure on file — renewal cron may have revoked Kisi after a failed charge.");
  }

  const paused = subs.some((s) => s.status === "Active" && String(s.subscription_pause_started ?? "").trim() !== "");
  if (paused) causes.push("Membership is paused — door access and Kisi grants are suspended.");

  if (appHasDoor && !kisiHasRole && waiverOk(row) && resolvedKisiId) {
    causes.push(
      "Paid/active in app but Kisi role missing or expired — common after failed renewal grant, import without migration grant, or grant API error."
    );
    causes.push("Renewals only re-grant when members.kisi_id exists (checkout creates it on first purchase).");
  }

  return causes;
}

function memberHasActiveDoorMembershipInApp(
  subs: Array<Record<string, unknown>>,
  todayYmd: string
): boolean {
  return subs.some((s) => {
    if (s.status !== "Active") return false;
    if (String(s.access_level ?? "").trim() === WEEKLY_GOALS_BOARD_ACCESS_LEVEL) return false;
    if (String(s.subscription_pause_started ?? "").trim() !== "") return false;
    const pc = s.pass_credits_remaining;
    if (pc != null && Number(pc) >= 0) return true;
    const start = normalizeDateToYMD(String(s.start_date ?? ""));
    if (start && start > todayYmd) return false;
    const exp = normalizeDateToYMD(String(s.expiry_date ?? ""));
    return !!exp && exp >= todayYmd;
  });
}

export async function auditOneMemberKisiAccess(
  db: ReturnType<typeof getDb>,
  tz: string,
  row: MemberAuditBase,
  options?: { lookupKisiByEmail?: boolean }
): Promise<KisiAccessAuditRow> {
  const todayYmd = todayInAppTz(tz);
  const subs = loadMemberSubscriptions(db, row.member_id);
  const appHasDoor = memberHasDoorAccessToday(subs, todayYmd, row.pass_activation_day);
  const activeInApp = memberHasActiveDoorMembershipInApp(subs, todayYmd);
  const appValidUntil = getSubscriptionDoorAccessValidUntil(db, row.member_id, tz);
  const failureRow = db
    .prepare(`SELECT COUNT(*) as c FROM payment_failures WHERE member_id = ? AND dismissed_at IS NULL`)
    .get(row.member_id) as { c: number };
  const openFailures = Number(failureRow?.c ?? 0) || 0;

  let resolvedKisiId = row.kisi_id?.trim() || null;
  if (options?.lookupKisiByEmail !== false && !resolvedKisiId && row.email?.trim()) {
    resolvedKisiId = (await findKisiUserByEmail(row.email.trim())) ?? null;
  }

  let kisiHasRole = false;
  let kisiValidUntilIso: string | null = null;
  if (resolvedKisiId) {
    const stale = await getKisiUserById(resolvedKisiId);
    if (!stale) {
      resolvedKisiId = null;
    } else {
      const assignments = await listRoleAssignmentsForUser(resolvedKisiId);
      const active = pickActiveDoorGroupAssignment(assignments);
      if (active?.valid_until) {
        kisiHasRole = true;
        kisiValidUntilIso = active.valid_until;
      }
    }
  }

  const waiverSigned = !!row.waiver_signed_at?.trim();
  const waiverExempt = Number(row.door_access_waiver_exempt) === 1;
  const expectsKisi = doorAccessFromNonGoalBoardSub(subs, todayYmd, row.pass_activation_day);

  let sync_status: KisiAccessSyncStatus = "in_sync";
  if (!appHasDoor && kisiHasRole) {
    sync_status = "app_no_access_has_kisi";
  } else if (expectsKisi && appHasDoor) {
    if (!waiverSigned && !waiverExempt) sync_status = "waiver_blocked";
    else if (!row.email?.trim()) sync_status = "no_email";
    else if (!resolvedKisiId) sync_status = "missing_kisi_user";
    else if (!kisiHasRole) {
      const assignments = resolvedKisiId ? await listRoleAssignmentsForUser(resolvedKisiId) : [];
      const envGroup = process.env.KISI_GROUP_ID?.trim();
      const envGroupNorm = envGroup ? String(parseInt(envGroup, 10) || envGroup) : null;
      const hadExpired = assignments.some((a) => {
        if (envGroupNorm && a.group_id != null) {
          const gNorm = String(parseInt(String(a.group_id), 10) || a.group_id);
          if (gNorm !== envGroupNorm) return false;
        }
        const until = a.valid_until ? new Date(a.valid_until).getTime() : NaN;
        return !Number.isNaN(until) && until <= Date.now();
      });
      sync_status = hadExpired ? "expired_role" : "missing_role";
      const passOnly = subs.some(
        (s) => s.status === "Active" && s.pass_credits_remaining != null && Number(s.pass_credits_remaining) >= 0
      );
      const passActiveToday =
        String(row.pass_activation_day ?? "").trim() === todayYmd ||
        subs.some((s) => s.status === "Active" && String(s.pass_activation_day ?? "").trim() === todayYmd);
      if (passOnly && !passActiveToday) {
        sync_status = "pass_not_activated";
      }
    }
  }

  const likely_causes = buildLikelyCauses({
    row,
    subs,
    todayYmd,
    appHasDoor: expectsKisi && appHasDoor,
    kisiHasRole,
    openFailures,
    resolvedKisiId,
  });

  return {
    member_id: row.member_id,
    email: row.email?.trim() || null,
    name: memberDisplayName(row),
    kisi_id: row.kisi_id?.trim() || null,
    app_has_door_access_today: appHasDoor,
    active_membership_in_app: activeInApp,
    app_valid_until_iso: appValidUntil?.toISOString() ?? null,
    waiver_signed: waiverSigned,
    waiver_exempt: waiverExempt,
    open_payment_failures: openFailures,
    subscription_summary: subscriptionSummary(subs, todayYmd),
    kisi_has_active_role: kisiHasRole,
    kisi_valid_until_iso: kisiValidUntilIso,
    sync_status,
    likely_causes,
  };
}

export async function runKisiAccessAudit(
  db: ReturnType<typeof getDb>,
  tz: string,
  options?: {
    mismatches_only?: boolean;
    lookup_kisi_by_email?: boolean;
    member_ids?: string[];
    limit?: number;
    offset?: number;
    /** active_in_app = Active door membership in our DB (default). all = every email on file (slow). */
    scope?: KisiAuditScope;
  }
): Promise<{
  today_ymd: string;
  timezone: string;
  audited_at?: string;
  kisi_configured: boolean;
  scope: KisiAuditScope;
  members_in_scope: number;
  members_scanned: number;
  in_sync: number;
  mismatches: KisiAccessAuditRow[];
  rows: KisiAccessAuditRow[];
}> {
  const rawScope = options?.scope as string | undefined;
  const scope: KisiAuditScope =
    rawScope === "all" ? "all" : rawScope === "active_door" || rawScope === "active_in_app" || !rawScope ? "active_in_app" : "active_in_app";
  const limit = Math.min(500, Math.max(1, options?.limit ?? 100));
  const offset = Math.max(0, options?.offset ?? 0);
  const todayYmd = todayInAppTz(tz);

  let memberRows: MemberAuditBase[];
  let membersInScope: number;

  if (options?.member_ids?.length) {
    membersInScope = options.member_ids.length;
    memberRows = loadMemberAuditRows(db, options.member_ids);
  } else if (scope === "active_in_app") {
    const ids = listMemberIdsForKisiAuditScope(db, tz);
    membersInScope = ids.length;
    memberRows = loadMemberAuditRows(db, ids.slice(offset, offset + limit));
  } else {
    membersInScope = countMembersForKisiAudit(db, tz, "all");
    memberRows = db
      .prepare(
        `SELECT member_id, email, first_name, last_name, kisi_id, waiver_signed_at,
                door_access_waiver_exempt, pass_activation_day
         FROM members
         WHERE email IS NOT NULL AND TRIM(email) != ''
         ORDER BY member_id ASC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as MemberAuditBase[];
  }

  const rows: KisiAccessAuditRow[] = [];
  for (let i = 0; i < memberRows.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 150));
    rows.push(
      await auditOneMemberKisiAccess(db, tz, memberRows[i]!, {
        lookupKisiByEmail: options?.lookup_kisi_by_email !== false,
      })
    );
  }

  const mismatches = rows.filter((r) => r.sync_status !== "in_sync");
  const filtered = options?.mismatches_only ? mismatches : rows;

  return {
    today_ymd: todayYmd,
    timezone: tz,
    audited_at: new Date().toISOString(),
    kisi_configured: !!(process.env.KISI_API_KEY?.trim() && process.env.KISI_GROUP_ID?.trim()),
    scope,
    members_in_scope: membersInScope,
    members_scanned: rows.length,
    in_sync: rows.filter((r) => r.sync_status === "in_sync").length,
    mismatches,
    rows: filtered,
  };
}
