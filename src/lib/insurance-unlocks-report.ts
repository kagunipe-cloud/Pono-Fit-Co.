import type { getDb } from "./db";
import { dateStringInAppTz } from "./app-timezone";
import {
  insuranceProgramWhereClause,
  type InsuranceReportFilter,
} from "./insurance-program";

type AppDb = ReturnType<typeof getDb>;

export type InsuranceUnlockRow = {
  id: number;
  uuid: string | null;
  lock_id: number | null;
  lock_name: string | null;
  success: number;
  happened_at: string;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  insurance_program: string | null;
  birthday: string | null;
  insurance_fitness_id: string | null;
};

export type InsuranceMemberSummary = {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  insurance_program: string | null;
  birthday: string | null;
  insurance_fitness_id: string | null;
  billable_days: number;
  all_unlocks: InsuranceUnlockRow[];
  billable_visits: InsuranceUnlockRow[];
};

const MAX_ROWS = 100_000;

export function loadInsuranceUnlocksReport(
  db: AppDb,
  opts: {
    program: InsuranceReportFilter;
    fromIso: string;
    toIso: string;
    timezone: string;
    successOnly?: boolean;
  }
): {
  members: InsuranceMemberSummary[];
  totalBillableDays: number;
  truncated: boolean;
  billableVisits: InsuranceUnlockRow[];
} {
  const successOnly = opts.successOnly !== false;
  const { clause, args } = insuranceProgramWhereClause(opts.program);
  const successClause = successOnly ? "AND d.success = 1" : "";

  const query = `SELECT d.id, d.uuid, d.lock_id, d.lock_name, d.success, d.happened_at,
                m.member_id, m.first_name, m.last_name, m.insurance_program,
                m.birthday, m.insurance_fitness_id
         FROM door_access_events d
         INNER JOIN members m ON m.member_id = d.member_id
         WHERE ${clause}
           AND d.happened_at >= ?
           AND d.happened_at <= ?
           ${successClause}
         ORDER BY d.happened_at ASC
         LIMIT ?`;

  const rows = db.prepare(query).all(...args, opts.fromIso, opts.toIso, MAX_ROWS) as InsuranceUnlockRow[];

  const sorted = [...rows].sort(
    (a, b) => new Date(a.happened_at).getTime() - new Date(b.happened_at).getTime()
  );
  const firstPerDayKey = new Set<string>();
  const firstOfDayRows: InsuranceUnlockRow[] = [];
  for (const r of sorted) {
    const ymd = dateStringInAppTz(r.happened_at, opts.timezone);
    const k = `${r.member_id}\t${ymd}`;
    if (firstPerDayKey.has(k)) continue;
    firstPerDayKey.add(k);
    firstOfDayRows.push(r);
  }

  const byMemberAll = new Map<string, InsuranceUnlockRow[]>();
  for (const r of rows) {
    const list = byMemberAll.get(r.member_id) ?? [];
    list.push(r);
    byMemberAll.set(r.member_id, list);
  }
  for (const list of byMemberAll.values()) {
    list.sort((a, b) => new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime());
  }

  const firstsByMember = new Map<string, InsuranceUnlockRow[]>();
  for (const r of firstOfDayRows) {
    const list = firstsByMember.get(r.member_id) ?? [];
    list.push(r);
    firstsByMember.set(r.member_id, list);
  }
  for (const list of firstsByMember.values()) {
    list.sort((a, b) => new Date(a.happened_at).getTime() - new Date(b.happened_at).getTime());
  }

  const memberIds = Array.from(byMemberAll.keys()).sort((a, b) => {
    const ra = byMemberAll.get(a)![0];
    const rb = byMemberAll.get(b)![0];
    const ln = (ra.last_name ?? "").localeCompare(rb.last_name ?? "", undefined, { sensitivity: "base" });
    if (ln !== 0) return ln;
    return (ra.first_name ?? "").localeCompare(rb.first_name ?? "", undefined, { sensitivity: "base" });
  });

  const members = memberIds.map((member_id) => {
    const all_unlocks = byMemberAll.get(member_id) ?? [];
    const fr = all_unlocks[0];
    const billable_visits = firstsByMember.get(member_id) ?? [];
    return {
      member_id,
      first_name: fr.first_name,
      last_name: fr.last_name,
      insurance_program: fr.insurance_program,
      birthday: fr.birthday,
      insurance_fitness_id: fr.insurance_fitness_id,
      billable_days: billable_visits.length,
      all_unlocks,
      billable_visits,
    };
  });

  return {
    members,
    totalBillableDays: firstOfDayRows.length,
    truncated: rows.length >= MAX_ROWS,
    billableVisits: firstOfDayRows,
  };
}
