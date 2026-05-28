import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";
import { ensureRecurringClassesTables, getMemberCreditBalance } from "../../../../../lib/recurring-classes";

export const dynamic = "force-dynamic";

function resolveMemberId(db: ReturnType<typeof getDb>, id: string): string | null {
  const isPurelyNumeric = /^\d+$/.test(id);
  const member = (isPurelyNumeric
    ? db.prepare("SELECT member_id FROM members WHERE id = ? OR member_id = ?").get(parseInt(id, 10), id)
    : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(id)) as { member_id: string } | undefined;
  return member?.member_id ?? null;
}

/** GET: current class credit ledger balance. Admin only. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(_request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const id = (await params).id;

  try {
    const db = getDb();
    const memberId = resolveMemberId(db, id);
    if (!memberId) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    ensureRecurringClassesTables(db);
    const balance = getMemberCreditBalance(db, memberId);
    db.close();
    return NextResponse.json({ balance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch class credits" }, { status: 500 });
  }
}

/**
 * POST: grant or remove class credits. Body:
 * { action?: 'grant' | 'remove', amount: number, note?: string }
 * Admin only. Grant adds positive rows; remove inserts negative amount up to current balance.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const id = (await params).id;
  let body: { action?: unknown; amount?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; amount?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actionRaw = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const action = actionRaw === "remove" ? "remove" : "grant";

  const rawAmt = Number(body.amount);
  const amount = Number.isFinite(rawAmt) ? Math.floor(rawAmt) : 0;
  if (amount < 1 || amount > 99) {
    return NextResponse.json({ error: "amount must be 1–99" }, { status: 400 });
  }

  const noteRaw = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";

  try {
    const db = getDb();
    const memberId = resolveMemberId(db, id);
    if (!memberId) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    ensureRecurringClassesTables(db);
    const balance = getMemberCreditBalance(db, memberId);

    if (action === "remove") {
      if (balance <= 0) {
        db.close();
        return NextResponse.json({ error: "No class credits to remove." }, { status: 400 });
      }
      const take = Math.min(amount, balance);
      const reason = noteRaw ? `Admin remove (${noteRaw})` : "Admin remove";
      const reference_id = `admin:${adminId}:${Date.now()}`;
      db.prepare(
        `INSERT INTO class_credit_ledger (member_id, amount, reason, reference_type, reference_id)
         VALUES (?, ?, ?, 'admin_remove', ?)`
      ).run(memberId, -take, reason, reference_id);
    } else {
      const reason = noteRaw ? `Admin grant (${noteRaw})` : "Admin grant";
      const reference_id = `admin:${adminId}:${Date.now()}`;
      db.prepare(
        `INSERT INTO class_credit_ledger (member_id, amount, reason, reference_type, reference_id)
         VALUES (?, ?, ?, 'admin_grant', ?)`
      ).run(memberId, amount, reason, reference_id);
    }

    const newBalance = getMemberCreditBalance(db, memberId);
    db.close();
    return NextResponse.json({
      ok: true,
      balance: newBalance,
      ...(action === "remove" ? { removed: Math.min(amount, balance) } : { granted: amount }),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update class credits" }, { status: 500 });
  }
}
