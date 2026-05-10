import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables, getPTCreditBalance, getPTCreditBalances, normalizePtDurationMinutes } from "../../../../../lib/pt-slots";
import { getAdminMemberId } from "../../../../../lib/admin";

export const dynamic = "force-dynamic";

function resolveMemberId(db: ReturnType<typeof getDb>, id: string): string | null {
  const isPurelyNumeric = /^\d+$/.test(id);
  const member = (isPurelyNumeric
    ? db.prepare("SELECT member_id FROM members WHERE id = ? OR member_id = ?").get(parseInt(id, 10), id)
    : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(id)) as { member_id: string } | undefined;
  return member?.member_id ?? null;
}

/** GET: PT credit balances keyed by duration_minutes. Admin only. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
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

    ensurePTSlotTables(db);
    const balances = getPTCreditBalances(db, memberId);
    db.close();
    return NextResponse.json(balances);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch PT credits" }, { status: 500 });
  }
}

/**
 * POST: grant or remove PT credits. Body:
 * { action?: 'grant' | 'remove', duration_minutes: number, amount: number, note?: string }
 * Admin only. Grant adds positive rows; remove inserts negative amount up to balance for that duration.
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
  let body: { action?: unknown; duration_minutes?: unknown; amount?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; duration_minutes?: unknown; amount?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actionRaw = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const action = actionRaw === "remove" ? "remove" : "grant";

  const duration_minutes = normalizePtDurationMinutes(body.duration_minutes, 0);
  if (duration_minutes <= 0) {
    return NextResponse.json({ error: "duration_minutes must be between 1 and 1440" }, { status: 400 });
  }

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

    const reference_id = `admin:${adminId}:${Date.now()}`;
    let removedInfo: { duration_minutes: number; amount: number } | undefined;
    let grantedInfo: { duration_minutes: number; amount: number } | undefined;

    if (action === "remove") {
      const balance = getPTCreditBalance(db, memberId, duration_minutes);
      if (balance <= 0) {
        db.close();
        return NextResponse.json({ error: `No ${duration_minutes}-minute PT credits to remove.` }, { status: 400 });
      }
      const take = Math.min(amount, balance);
      const reason = noteRaw ? `Admin remove (${noteRaw})` : "Admin remove";
      db.prepare(
        `INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id)
         VALUES (?, ?, ?, ?, 'admin_remove', ?)`
      ).run(memberId, duration_minutes, -take, reason, reference_id);
      removedInfo = { duration_minutes, amount: take };
    } else {
      const reason = noteRaw ? `Admin grant (${noteRaw})` : "Admin grant";
      db.prepare(
        `INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id)
         VALUES (?, ?, ?, ?, 'admin_grant', ?)`
      ).run(memberId, duration_minutes, amount, reason, reference_id);
      grantedInfo = { duration_minutes, amount };
    }

    const balances = getPTCreditBalances(db, memberId);
    db.close();
    return NextResponse.json({
      ok: true,
      balances,
      ...(removedInfo ? { removed: removedInfo } : {}),
      ...(grantedInfo ? { granted: grantedInfo } : {}),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update PT credits" }, { status: 500 });
  }
}
