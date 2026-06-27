import type { getDb } from "./db";
import { ensureMembersAutoRenewColumn } from "./db";
import { ensureDayPassCreditLedger } from "./day-pass-credits";
import { MEMBERSHIP_PLAN_JOIN_SQL } from "./mrr";
import {
  AUTO_RENEW_SOURCE_LABELS,
  ensureAutoRenewEventsTable,
  type AutoRenewChangeSource,
} from "./auto-renew-events";
import {
  classifyPlanMembershipSubcategory,
  type MembershipSubcategory,
} from "./membership-sales-breakdown";
import { startOfDayInTz, endOfDayInTz } from "./app-timezone";
import type { MembershipFlowKind, MembershipFlowRow, MembershipFlowTab } from "./membership-flow-shared";

export type {
  MembershipFlowKind,
  MembershipFlowRow,
  MembershipFlowTab,
  MembershipFlowMembershipKind,
} from "./membership-flow-shared";
export { FLOW_KIND_LABELS, MEMBERSHIP_FLOW_TABS } from "./membership-flow-shared";

type AppDb = ReturnType<typeof getDb>;

const TAB_TO_SUBCATEGORY: Record<Exclude<MembershipFlowTab, "all" | "auto-renew">, MembershipSubcategory> = {
  "monthly-recurring": "Monthly recurring",
  "monthly-non-recurring": "Monthly non-recurring",
  "day-pass": "Day pass",
  "week-pass": "Week pass",
  "pass-packs": "Pass packs",
};

const FLOW_KIND_SORT: Record<MembershipFlowKind, number> = {
  new_member: 0,
  plan_change: 1,
  renewal: 2,
  auto_renew_off: 3,
  auto_renew_on: 4,
};

function parseNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function hasPassCredits(sub: { pass_credits_remaining?: unknown }): boolean {
  const pc = sub.pass_credits_remaining;
  return pc != null && String(pc).trim() !== "";
}

function memberName(first: string | null, last: string | null, memberId: string): string {
  return [first, last].filter(Boolean).join(" ").trim() || memberId;
}

function priorMembershipCount(db: AppDb, memberId: string, beforeStartDate: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM subscriptions
       WHERE member_id = ? AND TRIM(COALESCE(start_date, '')) != ''
         AND start_date < ?`
    )
    .get(memberId, beforeStartDate) as { c: number };
  return Number(row?.c) || 0;
}

function priorPlanName(db: AppDb, memberId: string, beforeStartDate: string): string | null {
  const row = db
    .prepare(
      `SELECT p.plan_name
       FROM subscriptions s
       LEFT JOIN membership_plans p ON ${MEMBERSHIP_PLAN_JOIN_SQL}
       WHERE s.member_id = ? AND TRIM(COALESCE(s.start_date, '')) != ''
         AND s.start_date < ?
       ORDER BY s.start_date DESC
       LIMIT 1`
    )
    .get(memberId, beforeStartDate) as { plan_name: string | null } | undefined;
  return row?.plan_name?.trim() || null;
}

function classifyFlowKind(saleType: string, priorCount: number): MembershipFlowKind {
  const st = String(saleType ?? "").trim().toLowerCase();
  if (st === "renewal") return "renewal";
  if (priorCount === 0) return "new_member";
  return "plan_change";
}

function eventTimestamp(dateTime: string | null, saleDate: string | null, startDate: string | null): string {
  const dt = (dateTime ?? "").trim();
  if (dt) return dt.length >= 19 ? dt.slice(0, 19) : dt;
  const sd = (saleDate ?? startDate ?? "").trim();
  if (sd) return `${sd} 12:00:00`;
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function matchesTab(row: MembershipFlowRow, tab: MembershipFlowTab): boolean {
  if (tab === "all") return true;
  if (tab === "auto-renew") {
    return row.flow_kind === "auto_renew_on" || row.flow_kind === "auto_renew_off";
  }
  return row.membership_kind === TAB_TO_SUBCATEGORY[tab];
}

export function buildMembershipFlowReport(
  db: AppDb,
  from: string,
  to: string,
  tz: string,
  tab: MembershipFlowTab = "all"
): {
  events: MembershipFlowRow[];
  summary: Record<MembershipFlowKind, number>;
} {
  ensureMembersAutoRenewColumn(db);
  ensureAutoRenewEventsTable(db);
  ensureDayPassCreditLedger(db);

  const fromSql = startOfDayInTz(from, tz).replace("T", " ").slice(0, 19);
  const toSql = endOfDayInTz(to, tz).replace("T", " ").slice(0, 19);

  const events: MembershipFlowRow[] = [];

  const saleRows = db
    .prepare(
      `SELECT s.sales_id, s.member_id, s.date_time, s.sale_date, s.sale_type,
              CAST(s.grand_total AS REAL) AS grand_total,
              m.first_name, m.last_name, m.email, COALESCE(m.auto_renew, 0) AS auto_renew,
              sub.subscription_id, sub.product_id, sub.start_date, sub.pass_credits_remaining,
              p.plan_name, p.unit, p.category
       FROM sales s
       INNER JOIN subscriptions sub ON sub.sales_id = s.sales_id
       LEFT JOIN membership_plans p ON ${MEMBERSHIP_PLAN_JOIN_SQL.replace(/s\./g, "sub.")}
       INNER JOIN members m ON m.member_id = s.member_id
       WHERE s.status != 'Refunded'
         AND s.sale_date >= ? AND s.sale_date <= ?`
    )
    .all(from, to) as {
    sales_id: string;
    member_id: string;
    date_time: string | null;
    sale_date: string | null;
    sale_type: string | null;
    grand_total: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    auto_renew: number;
    subscription_id: string;
    product_id: string | null;
    start_date: string | null;
    pass_credits_remaining: number | string | null;
    plan_name: string | null;
    unit: string | null;
    category: string | null;
  }[];

  for (const r of saleRows) {
    const startDate = (r.start_date ?? r.sale_date ?? from).trim();
    const priorCount = priorMembershipCount(db, r.member_id, startDate || from);
    const flowKind = classifyFlowKind(r.sale_type ?? "", priorCount);
    const membershipKind =
      classifyPlanMembershipSubcategory(
        { unit: r.unit, category: r.category },
        r.sale_type ?? "",
        r.auto_renew,
        hasPassCredits(r)
      ) ?? "Monthly non-recurring";
    const happenedAt = eventTimestamp(r.date_time, r.sale_date, r.start_date);
    const prevPlan = flowKind === "plan_change" ? priorPlanName(db, r.member_id, startDate || from) : null;
    let detail: string | null = null;
    if (flowKind === "plan_change" && prevPlan && prevPlan !== (r.plan_name ?? "").trim()) {
      detail = `Was: ${prevPlan}`;
    } else if (flowKind === "plan_change" && prevPlan) {
      detail = `Same plan repurchase`;
    }

    events.push({
      id: `sale-${r.sales_id}-${r.subscription_id}`,
      happened_at: happenedAt,
      member_id: r.member_id,
      member_name: memberName(r.first_name, r.last_name, r.member_id),
      email: r.email,
      flow_kind: flowKind,
      membership_kind: membershipKind,
      plan_name: r.plan_name?.trim() || null,
      previous_plan_name: prevPlan,
      auto_renew: r.auto_renew,
      amount: parseNum(r.grand_total) || null,
      detail,
      sort_priority: FLOW_KIND_SORT[flowKind],
    });
  }

  const passPackSales = db
    .prepare(
      `SELECT s.sales_id, s.member_id, s.date_time, s.sale_date, s.sale_type,
              CAST(s.grand_total AS REAL) AS grand_total,
              m.first_name, m.last_name, m.email, COALESCE(m.auto_renew, 0) AS auto_renew,
              l.created_at
       FROM day_pass_credit_ledger l
       INNER JOIN sales s ON l.reference_type = 'sale' AND l.reference_id = s.sales_id AND l.reason = 'purchase'
       INNER JOIN members m ON m.member_id = s.member_id
       WHERE s.status != 'Refunded'
         AND s.sale_date >= ? AND s.sale_date <= ?
         AND NOT EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.sales_id = s.sales_id)`
    )
    .all(from, to) as {
    sales_id: string;
    member_id: string;
    date_time: string | null;
    sale_date: string | null;
    sale_type: string | null;
    grand_total: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    auto_renew: number;
    created_at: string | null;
  }[];

  for (const r of passPackSales) {
    const startDate = (r.sale_date ?? from).trim();
    const priorCount = priorMembershipCount(db, r.member_id, startDate || from);
    const flowKind = classifyFlowKind(r.sale_type ?? "", priorCount);
    const happenedAt = eventTimestamp(r.date_time ?? r.created_at, r.sale_date, null);

    events.push({
      id: `passpack-${r.sales_id}`,
      happened_at: happenedAt,
      member_id: r.member_id,
      member_name: memberName(r.first_name, r.last_name, r.member_id),
      email: r.email,
      flow_kind: flowKind,
      membership_kind: "Pass packs",
      plan_name: "Pass pack",
      previous_plan_name: flowKind === "plan_change" ? priorPlanName(db, r.member_id, startDate || from) : null,
      auto_renew: r.auto_renew,
      amount: parseNum(r.grand_total) || null,
      detail: null,
      sort_priority: FLOW_KIND_SORT[flowKind],
    });
  }

  const orphanSubs = db
    .prepare(
      `SELECT sub.subscription_id, sub.member_id, sub.product_id, sub.start_date, sub.price,
              sub.pass_credits_remaining, sub.sales_id,
              m.first_name, m.last_name, m.email, COALESCE(m.auto_renew, 0) AS auto_renew,
              p.plan_name, p.unit, p.category
       FROM subscriptions sub
       INNER JOIN members m ON m.member_id = sub.member_id
       LEFT JOIN membership_plans p ON ${MEMBERSHIP_PLAN_JOIN_SQL.replace(/s\./g, "sub.")}
       WHERE (sub.sales_id IS NULL OR TRIM(sub.sales_id) = '')
         AND sub.start_date >= ? AND sub.start_date <= ?`
    )
    .all(from, to) as {
    subscription_id: string;
    member_id: string;
    product_id: string | null;
    start_date: string | null;
    price: string | null;
    pass_credits_remaining: number | string | null;
    sales_id: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    auto_renew: number;
    plan_name: string | null;
    unit: string | null;
    category: string | null;
  }[];

  for (const r of orphanSubs) {
    const startDate = (r.start_date ?? from).trim();
    const priorCount = priorMembershipCount(db, r.member_id, startDate || from);
    const flowKind = priorCount === 0 ? "new_member" : "plan_change";
    const membershipKind =
      classifyPlanMembershipSubcategory(
        { unit: r.unit, category: r.category },
        "",
        r.auto_renew,
        hasPassCredits(r)
      ) ?? "Monthly non-recurring";

    events.push({
      id: `sub-${r.subscription_id}`,
      happened_at: eventTimestamp(null, null, r.start_date),
      member_id: r.member_id,
      member_name: memberName(r.first_name, r.last_name, r.member_id),
      email: r.email,
      flow_kind: flowKind,
      membership_kind: membershipKind,
      plan_name: r.plan_name?.trim() || null,
      previous_plan_name: flowKind === "plan_change" ? priorPlanName(db, r.member_id, startDate || from) : null,
      auto_renew: r.auto_renew,
      amount: parseNum(r.price) || null,
      detail: "Import / complimentary / gift",
      sort_priority: FLOW_KIND_SORT[flowKind],
    });
  }

  const autoRenewRows = db
    .prepare(
      `SELECT e.id, e.member_id, e.enabled, e.previous_enabled, e.changed_at, e.source,
              m.first_name, m.last_name, m.email
       FROM auto_renew_events e
       INNER JOIN members m ON m.member_id = e.member_id
       WHERE e.changed_at >= ? AND e.changed_at <= ?`
    )
    .all(fromSql, toSql) as {
    id: number;
    member_id: string;
    enabled: number;
    previous_enabled: number | null;
    changed_at: string;
    source: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  }[];

  for (const r of autoRenewRows) {
    const flowKind: MembershipFlowKind = r.enabled === 1 ? "auto_renew_on" : "auto_renew_off";
    const sourceLabel = AUTO_RENEW_SOURCE_LABELS[r.source as AutoRenewChangeSource] ?? r.source;
    events.push({
      id: `autorenew-${r.id}`,
      happened_at: r.changed_at,
      member_id: r.member_id,
      member_name: memberName(r.first_name, r.last_name, r.member_id),
      email: r.email,
      flow_kind: flowKind,
      membership_kind: "Auto-renew",
      plan_name: null,
      previous_plan_name: null,
      auto_renew: r.enabled,
      amount: null,
      detail: sourceLabel,
      sort_priority: FLOW_KIND_SORT[flowKind],
    });
  }

  events.sort((a, b) => {
    if (a.sort_priority !== b.sort_priority) return a.sort_priority - b.sort_priority;
    return b.happened_at.localeCompare(a.happened_at);
  });

  const filtered = tab === "all" ? events : events.filter((e) => matchesTab(e, tab));

  const summary: Record<MembershipFlowKind, number> = {
    new_member: 0,
    plan_change: 0,
    renewal: 0,
    auto_renew_on: 0,
    auto_renew_off: 0,
  };
  for (const e of events) {
    summary[e.flow_kind] += 1;
  }

  return { events: filtered, summary };
}
