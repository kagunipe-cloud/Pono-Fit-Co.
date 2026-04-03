import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureRecurringClassesTables } from "@/lib/recurring-classes";
import { ensurePTSlotTables } from "@/lib/pt-slots";

export const dynamic = "force-dynamic";

type Tab = "class" | "pt" | "pass";

export type OpenCreditsClassRow = { member_id: string; member_name: string; credits: number };
export type OpenCreditsPtRow = {
  member_id: string;
  member_name: string;
  buckets: { duration_minutes: number; credits: number }[];
};
export type OpenCreditsGiftRow = {
  kind: "gift_pending";
  id: number;
  recipient_email: string;
  plan_name: string | null;
  created_at: string | null;
  purchaser_name: string;
  purchaser_member_id: string;
};
export type OpenCreditsPassSubRow = {
  kind: "subscription";
  subscription_id: string | null;
  member_id: string;
  member_name: string;
  plan_name: string | null;
  pass_credits_remaining: number;
  pass_activation_day: string | null;
  status: string | null;
};

export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tab = (request.nextUrl.searchParams.get("tab") ?? "class").toLowerCase() as Tab;
  if (tab !== "class" && tab !== "pt" && tab !== "pass") {
    return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  let db: ReturnType<typeof getDb> | null = null;
  try {
    db = getDb();
    if (tab === "class") {
      ensureRecurringClassesTables(db);
      const agg = db
        .prepare(
          `SELECT l.member_id, SUM(l.amount) AS credits, m.first_name, m.last_name
           FROM class_credit_ledger l
           JOIN members m ON m.member_id = l.member_id
           GROUP BY l.member_id
           HAVING SUM(l.amount) > 0
           ORDER BY m.last_name COLLATE NOCASE, m.first_name COLLATE NOCASE`
        )
        .all() as { member_id: string; credits: number; first_name: string | null; last_name: string | null }[];

      let rows: OpenCreditsClassRow[] = agg.map((r) => ({
        member_id: r.member_id,
        member_name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id,
        credits: Number(r.credits ?? 0),
      }));
      if (q) {
        rows = rows.filter((r) => r.member_name.toLowerCase().includes(q) || r.member_id.toLowerCase().includes(q));
      }
      return NextResponse.json({ tab: "class", rows });
    }

    if (tab === "pt") {
      ensurePTSlotTables(db);
      const raw = db
        .prepare(
          `SELECT l.member_id, l.duration_minutes, SUM(l.amount) AS credits, m.first_name, m.last_name
           FROM pt_credit_ledger l
           JOIN members m ON m.member_id = l.member_id
           GROUP BY l.member_id, l.duration_minutes
           HAVING SUM(l.amount) > 0
           ORDER BY m.last_name COLLATE NOCASE, m.first_name COLLATE NOCASE, l.duration_minutes`
        )
        .all() as {
          member_id: string;
          duration_minutes: number;
          credits: number;
          first_name: string | null;
          last_name: string | null;
        }[];

      const byMember = new Map<string, { member_name: string; buckets: { duration_minutes: number; credits: number }[] }>();
      for (const r of raw) {
        const credits = Number(r.credits ?? 0);
        if (credits <= 0) continue;
        const member_name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.member_id;
        const existing = byMember.get(r.member_id);
        const bucket = { duration_minutes: r.duration_minutes, credits };
        if (existing) {
          existing.buckets.push(bucket);
        } else {
          byMember.set(r.member_id, { member_name, buckets: [bucket] });
        }
      }

      let rows: OpenCreditsPtRow[] = [...byMember.entries()].map(([member_id, v]) => ({
        member_id,
        member_name: v.member_name,
        buckets: v.buckets,
      }));
      if (q) {
        rows = rows.filter((r) => r.member_name.toLowerCase().includes(q) || r.member_id.toLowerCase().includes(q));
      }
      return NextResponse.json({ tab: "pt", rows });
    }

    const gifts = db
      .prepare(
        `SELECT g.id, g.recipient_email, g.status, g.created_at, mp.plan_name,
                pur.first_name AS purchaser_first, pur.last_name AS purchaser_last, g.purchaser_member_id
         FROM gift_passes g
         JOIN membership_plans mp ON mp.id = g.membership_plan_id
         LEFT JOIN members pur ON pur.member_id = g.purchaser_member_id
         WHERE g.status = 'pending'
         ORDER BY g.created_at DESC`
      )
      .all() as {
        id: number;
        recipient_email: string;
        status: string;
        created_at: string | null;
        plan_name: string | null;
        purchaser_first: string | null;
        purchaser_last: string | null;
        purchaser_member_id: string;
      }[];

    let giftRows: OpenCreditsGiftRow[] = gifts.map((g) => ({
      kind: "gift_pending" as const,
      id: g.id,
      recipient_email: g.recipient_email,
      plan_name: g.plan_name,
      created_at: g.created_at,
      purchaser_name: [g.purchaser_first, g.purchaser_last].filter(Boolean).join(" ").trim() || g.purchaser_member_id,
      purchaser_member_id: g.purchaser_member_id,
    }));

    const subs = db
      .prepare(
        `SELECT s.subscription_id, s.member_id, s.status, s.pass_credits_remaining, s.pass_activation_day, mp.plan_name,
                m.first_name, m.last_name
         FROM subscriptions s
         LEFT JOIN membership_plans mp ON mp.product_id = s.product_id
         JOIN members m ON m.member_id = s.member_id
         WHERE s.pass_credits_remaining IS NOT NULL AND s.pass_credits_remaining > 0
           AND (s.status IS NULL OR s.status != 'Cancelled')
         ORDER BY m.last_name COLLATE NOCASE, m.first_name COLLATE NOCASE`
      )
      .all() as {
        subscription_id: string | null;
        member_id: string;
        status: string | null;
        pass_credits_remaining: number | null;
        pass_activation_day: string | null;
        plan_name: string | null;
        first_name: string | null;
        last_name: string | null;
      }[];

    let subRows: OpenCreditsPassSubRow[] = subs.map((s) => ({
      kind: "subscription" as const,
      subscription_id: s.subscription_id,
      member_id: s.member_id,
      member_name: [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.member_id,
      plan_name: s.plan_name,
      pass_credits_remaining: Number(s.pass_credits_remaining ?? 0),
      pass_activation_day: s.pass_activation_day,
      status: s.status,
    }));

    if (q) {
      giftRows = giftRows.filter(
        (g) =>
          g.recipient_email.toLowerCase().includes(q) ||
          (g.plan_name ?? "").toLowerCase().includes(q) ||
          g.purchaser_name.toLowerCase().includes(q)
      );
      subRows = subRows.filter(
        (s) => s.member_name.toLowerCase().includes(q) || s.member_id.toLowerCase().includes(q) || (s.plan_name ?? "").toLowerCase().includes(q)
      );
    }

    return NextResponse.json({ tab: "pass", gifts: giftRows, subscriptions: subRows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load open credits" }, { status: 500 });
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}
