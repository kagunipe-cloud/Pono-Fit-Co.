import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensurePaymentFailuresTable } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { todayInAppTz } from "@/lib/app-timezone";
import { ensureRecurringClassesTables } from "@/lib/recurring-classes";
import { ensurePTSlotTables } from "@/lib/pt-slots";
import { ensureUsageTables } from "@/lib/usage";

export const dynamic = "force-dynamic";

function hasPurchase(db: ReturnType<typeof getDb>, memberId: string): boolean {
  const checks = [
    "SELECT 1 FROM subscriptions WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM class_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM occurrence_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_slot_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_trainer_specific_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_open_bookings WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM class_credit_ledger WHERE member_id = ? LIMIT 1",
    "SELECT 1 FROM pt_credit_ledger WHERE member_id = ? LIMIT 1",
  ];
  for (const sql of checks) {
    try {
      if (db.prepare(sql).get(memberId)) return true;
    } catch {
      /* table may not exist */
    }
  }
  return false;
}

/**
 * GET — Returns members with email who match the given filters. Admin only.
 * Query params: trial_complimentary_expired_days, complimentary_product_type, complimentary_product_id,
 *   plan_status, join_date_in_days, min_class_bookings, min_pt_bookings, min_visits, visits_in_days,
 *   is_lead, failed_payment, failed_payment_days, failed_payment_plan_id
 * ?include_options=1 — also returns plans, classes, etc. for filter dropdowns
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const trialDays = parseInt(String(searchParams.get("trial_complimentary_expired_days") ?? ""), 10);
  const compType = searchParams.get("complimentary_product_type")?.trim() || undefined;
  const compProductId = parseInt(String(searchParams.get("complimentary_product_id") ?? ""), 10);
  const planStatus = searchParams.get("plan_status")?.trim() || undefined;
  const joinDateInDays = parseInt(String(searchParams.get("join_date_in_days") ?? ""), 10);
  const minClassBookings = parseInt(String(searchParams.get("min_class_bookings") ?? ""), 10);
  const minPtBookings = parseInt(String(searchParams.get("min_pt_bookings") ?? ""), 10);
  const minVisits = parseInt(String(searchParams.get("min_visits") ?? ""), 10);
  const visitsInDays = parseInt(String(searchParams.get("visits_in_days") ?? ""), 10);
  const isLead = searchParams.get("is_lead") === "1";
  const failedPayment = searchParams.get("failed_payment") === "1";
  const failedPaymentDays = parseInt(String(searchParams.get("failed_payment_days") ?? ""), 10);
  const failedPaymentPlanId = parseInt(String(searchParams.get("failed_payment_plan_id") ?? ""), 10);
  const includeOptions = searchParams.get("include_options") === "1";

  const db = getDb();
  const tz = getAppTimezone(db);
  const today = todayInAppTz(tz);

  let memberIds: Set<string> | null = null;

  // Filter: trial/complimentary period expired in X days
  if (trialDays > 0 && trialDays <= 365) {
    const todayDate = new Date(today + "T12:00:00");
    todayDate.setDate(todayDate.getDate() - trialDays);
    const startStr = todayDate.toISOString().slice(0, 10);

    // Subscriptions with price=0 (free/trial/complimentary) that expired between today-X and today
    let sql = `
      SELECT DISTINCT s.member_id
      FROM subscriptions s
      JOIN members m ON m.member_id = s.member_id
      WHERE TRIM(COALESCE(m.email, '')) != ''
        AND (COALESCE(s.price, '0') = '0' OR CAST(s.price AS REAL) = 0)
        AND s.expiry_date >= ? AND s.expiry_date <= ?
    `;
    const params: (string | number)[] = [startStr, today];

    // Narrow by product type/product when specified
    if (compType === "membership_plan" && !Number.isNaN(compProductId) && compProductId > 0) {
      sql += ` AND s.product_id = (SELECT product_id FROM membership_plans WHERE id = ?)`;
      params.push(compProductId);
    } else if (compType === "membership_plan" && (Number.isNaN(compProductId) || compProductId <= 0)) {
      // membership_plan: ensure we're only looking at membership subscriptions (product_id exists in membership_plans)
      sql += ` AND s.product_id IN (SELECT product_id FROM membership_plans)`;
    }

    const rows = db.prepare(sql).all(...params) as { member_id: string }[];
    memberIds = new Set(rows.map((r) => r.member_id));
  }

  // If no trial filter, get all members with email as base set
  if (memberIds === null) {
    const rows = db
      .prepare(
        "SELECT member_id FROM members WHERE TRIM(COALESCE(email, '')) != '' ORDER BY last_name ASC, first_name ASC"
      )
      .all() as { member_id: string }[];
    memberIds = new Set(rows.map((r) => r.member_id));
  }

  // If complimentary filter by type/product (without trial expiry) - "has received complimentary of type X"
  // Only apply when trialDays not set (otherwise we already filtered by membership)
  if (memberIds.size > 0 && !trialDays && compType && compType !== "membership_plan") {
    ensurePTSlotTables(db);
    ensureRecurringClassesTables(db);

    let compMemberIds: string[] = [];
    if (compType === "pt_session") {
      const fromLedger = db.prepare("SELECT DISTINCT member_id FROM pt_credit_ledger WHERE reason = 'complimentary'").all() as { member_id: string }[];
      const fromBookings = db.prepare("SELECT DISTINCT member_id FROM pt_bookings WHERE price = '0' OR price = '0.0'").all() as { member_id: string }[];
      compMemberIds = [...new Set([...fromLedger.map((r) => r.member_id), ...fromBookings.map((r) => r.member_id)])];
      if (!Number.isNaN(compProductId) && compProductId > 0) {
        const session = db.prepare("SELECT product_id FROM pt_sessions WHERE id = ?").get(compProductId) as { product_id: string } | undefined;
        if (session) {
          const byProduct = db.prepare("SELECT DISTINCT member_id FROM pt_bookings WHERE product_id = ? AND (price = '0' OR price = '0.0')").all(session.product_id) as { member_id: string }[];
          compMemberIds = byProduct.map((r) => r.member_id);
        }
      }
    } else if (compType === "class") {
      let byProduct: { member_id: string }[] = [];
      if (!Number.isNaN(compProductId) && compProductId > 0) {
        const cls = db.prepare("SELECT product_id FROM classes WHERE id = ?").get(compProductId) as { product_id: string } | undefined;
        if (cls) {
          byProduct = db.prepare("SELECT DISTINCT member_id FROM class_bookings WHERE product_id = ? AND (price = '0' OR price = '0.0')").all(cls.product_id) as { member_id: string }[];
        }
      }
      compMemberIds = byProduct.length > 0 ? byProduct.map((r) => r.member_id) : (db.prepare("SELECT DISTINCT member_id FROM class_bookings WHERE price = '0' OR price = '0.0'").all() as { member_id: string }[]).map((r) => r.member_id);
    } else if (compType === "class_pack") {
      compMemberIds = (db.prepare("SELECT DISTINCT member_id FROM class_credit_ledger WHERE reason = 'complimentary'").all() as { member_id: string }[]).map((r) => r.member_id);
    } else if (compType === "pt_pack") {
      compMemberIds = (db.prepare("SELECT DISTINCT member_id FROM pt_credit_ledger WHERE reason = 'complimentary'").all() as { member_id: string }[]).map((r) => r.member_id);
    }
    if (compMemberIds.length > 0) {
      const compSet = new Set(compMemberIds);
      memberIds = new Set([...memberIds].filter((id) => compSet.has(id)));
    } else {
      memberIds = new Set();
    }
  }

  // Filter: plan status (active, expired, cancelled, none)
  if (memberIds && memberIds.size > 0 && planStatus) {
    if (planStatus === "active") {
      const active = db.prepare(`
        SELECT DISTINCT member_id FROM subscriptions WHERE status = 'Active'
      `).all() as { member_id: string }[];
      const set = new Set(active.map((r) => r.member_id));
      memberIds = new Set([...memberIds].filter((id) => set.has(id)));
    } else if (planStatus === "expired") {
      const expired = db.prepare(`
        SELECT DISTINCT member_id FROM subscriptions WHERE status = 'Expired'
      `).all() as { member_id: string }[];
      const set = new Set(expired.map((r) => r.member_id));
      memberIds = new Set([...memberIds].filter((id) => set.has(id)));
    } else if (planStatus === "cancelled") {
      const cancelled = db.prepare(`
        SELECT DISTINCT member_id FROM subscriptions WHERE status = 'Cancelled'
      `).all() as { member_id: string }[];
      const set = new Set(cancelled.map((r) => r.member_id));
      memberIds = new Set([...memberIds].filter((id) => set.has(id)));
    } else if (planStatus === "none") {
      const withSub = db.prepare("SELECT DISTINCT member_id FROM subscriptions").all() as { member_id: string }[];
      const set = new Set(withSub.map((r) => r.member_id));
      memberIds = new Set([...memberIds].filter((id) => !set.has(id)));
    }
  }

  // Filter: join date (joined in last X days)
  if (memberIds && memberIds.size > 0 && joinDateInDays > 0 && joinDateInDays <= 3650) {
    const cutoff = new Date(today + "T12:00:00");
    cutoff.setDate(cutoff.getDate() - joinDateInDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT member_id FROM members WHERE join_date >= ? AND TRIM(COALESCE(email, '')) != ''
    `).all(cutoffStr) as { member_id: string }[];
    const set = new Set(rows.map((r) => r.member_id));
    memberIds = new Set([...memberIds].filter((id) => set.has(id)));
  }

  // Filter: min class bookings
  if (memberIds && memberIds.size > 0 && minClassBookings > 0) {
    ensureRecurringClassesTables(db);
    const classTables = ["class_bookings", "occurrence_bookings"];
    const parts: string[] = [];
    for (const t of classTables) {
      try {
        db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get();
        parts.push(`SELECT member_id FROM ${t}`);
      } catch {
        /* table may not exist */
      }
    }
    if (parts.length > 0) {
      const sql = `SELECT member_id, COUNT(*) as cnt FROM (${parts.join(" UNION ALL ")}) GROUP BY member_id HAVING cnt >= ?`;
      const rows = db.prepare(sql).all(minClassBookings) as { member_id: string }[];
      const set = new Set(rows.map((r) => r.member_id));
      memberIds = new Set([...memberIds].filter((id) => set.has(id)));
    }
  }

  // Filter: min PT bookings
  if (memberIds && memberIds.size > 0 && minPtBookings > 0) {
    ensurePTSlotTables(db);
    const ptTables = ["pt_bookings", "pt_slot_bookings", "pt_trainer_specific_bookings", "pt_open_bookings"];
    const parts: string[] = [];
    for (const t of ptTables) {
      try {
        db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get();
        parts.push(`SELECT member_id FROM ${t}`);
      } catch {
        /* table may not exist */
      }
    }
    if (parts.length > 0) {
      const sql = `SELECT member_id, COUNT(*) as cnt FROM (${parts.join(" UNION ALL ")}) GROUP BY member_id HAVING cnt >= ?`;
      const rows = db.prepare(sql).all(minPtBookings) as { member_id: string }[];
      const set = new Set(rows.map((r) => r.member_id));
      memberIds = new Set([...memberIds].filter((id) => set.has(id)));
    }
  }

  // Filter: min visits (door check-ins) in last X days
  if (memberIds && memberIds.size > 0 && minVisits > 0 && visitsInDays > 0 && visitsInDays <= 365) {
    ensureUsageTables(db);
    const cutoff = new Date(Date.now() - visitsInDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const rows = db.prepare(`
      SELECT member_id, COUNT(*) as cnt FROM door_access_events
      WHERE happened_at >= ? AND member_id IS NOT NULL AND member_id != ''
      GROUP BY member_id HAVING cnt >= ?
    `).all(cutoff, minVisits) as { member_id: string }[];
    const set = new Set(rows.map((r) => r.member_id));
    memberIds = new Set([...memberIds].filter((id) => set.has(id)));
  }

  // Filter: is lead (no purchase)
  if (memberIds && memberIds.size > 0 && isLead) {
    memberIds = new Set([...memberIds].filter((id) => !hasPurchase(db, id)));
  }

  // Filter: failed payments (has failed, or failed in last X days, optional by plan)
  if (memberIds && memberIds.size > 0 && (failedPayment || (failedPaymentDays > 0 && failedPaymentDays <= 365))) {
    ensurePaymentFailuresTable(db);
    let sql = `SELECT DISTINCT member_id FROM payment_failures f
      JOIN members m ON m.member_id = f.member_id
      WHERE TRIM(COALESCE(m.email, '')) != ''`;
    const params: (string | number)[] = [];
    if (failedPaymentDays > 0) {
      const cutoff = new Date(Date.now() - failedPaymentDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
      sql += ` AND f.attempted_at >= ?`;
      params.push(cutoff);
    }
    if (!Number.isNaN(failedPaymentPlanId) && failedPaymentPlanId > 0) {
      sql += ` AND f.plan_name = (SELECT plan_name FROM membership_plans WHERE id = ?)`;
      params.push(failedPaymentPlanId);
    }
    const rows = db.prepare(sql).all(...params) as { member_id: string }[];
    const set = new Set(rows.map((r) => r.member_id));
    memberIds = new Set([...memberIds].filter((id) => set.has(id)));
  }

  const ids = Array.from(memberIds ?? new Set());

  const result: { member_ids: string[]; count: number; plans?: { id: number; plan_name: string }[]; sessions?: { id: number; session_name: string }[]; classes?: { id: number; class_name: string }[]; classPacks?: { id: number; name: string }[]; ptPackProducts?: { id: number; name: string }[] } = {
    member_ids: ids,
    count: ids.length,
  };

  if (includeOptions) {
    result.plans = db.prepare("SELECT id, plan_name FROM membership_plans ORDER BY plan_name").all() as { id: number; plan_name: string }[];
    ensurePTSlotTables(db);
    result.sessions = db.prepare("SELECT id, session_name FROM pt_sessions ORDER BY session_name").all() as { id: number; session_name: string }[];
    result.classes = db.prepare("SELECT id, class_name FROM classes ORDER BY class_name").all() as { id: number; class_name: string }[];
    ensureRecurringClassesTables(db);
    result.classPacks = db.prepare("SELECT id, name FROM class_pack_products ORDER BY name").all() as { id: number; name: string }[];
    result.ptPackProducts = db.prepare("SELECT id, name FROM pt_pack_products ORDER BY name").all() as { id: number; name: string }[];
  }

  db.close();
  return NextResponse.json(result);
}
