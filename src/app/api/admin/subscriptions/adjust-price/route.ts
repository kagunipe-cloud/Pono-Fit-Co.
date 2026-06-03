import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";

export const dynamic = "force-dynamic";

function normalizePriceInput(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(raw ?? "")
    .replace(/[$,]/g, "")
    .trim();
  if (s === "") return { ok: false, error: "Price is required" };
  const n = parseFloat(s);
  if (Number.isNaN(n) || n < 0) return { ok: false, error: "Enter a valid non-negative number" };
  if (n > 999_999.99) return { ok: false, error: "Price is too large" };
  return { ok: true, value: n.toFixed(2) };
}

/**
 * POST — Admin: set `subscriptions.price` (staff-negotiated / override amount used for renewals and display).
 * Body: `{ subscription_id: string, price: string | number }`
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { subscription_id?: string; price?: unknown };
  try {
    body = (await request.json()) as { subscription_id?: string; price?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subscriptionId = String(body.subscription_id ?? "").trim();
  if (!subscriptionId) {
    return NextResponse.json({ error: "subscription_id required" }, { status: 400 });
  }

  const parsed = normalizePriceInput(body.price);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT subscription_id, member_id, status, price FROM subscriptions WHERE subscription_id = ?`)
    .get(subscriptionId) as { subscription_id: string; member_id: string; status: string; price: string | null } | undefined;

  if (!row) {
    db.close();
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  const previous = row.price;

  try {
    db.prepare(`UPDATE subscriptions SET price = ? WHERE subscription_id = ?`).run(parsed.value, subscriptionId);
    db.close();
    return NextResponse.json({
      ok: true,
      subscription_id: subscriptionId,
      member_id: row.member_id,
      price: parsed.value,
      previous_price: previous,
    });
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    console.error("[adjust-price]", e);
    const msg = e instanceof Error ? e.message : "Failed to update";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
