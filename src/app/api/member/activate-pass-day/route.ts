import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { todayInAppTz } from "@/lib/app-timezone";
import {
  ensureDayPassCreditLedger,
  ensureMembersPassActivationDayColumn,
  getMemberDayPassLedgerBalance,
  migrateLegacyPassPackSubscriptionsToLedger,
} from "@/lib/day-pass-credits";
import { grantAccess as kisiGrantAccess, ensureKisiUser } from "@/lib/kisi";
import { ensureWaiverBeforeKisi } from "@/lib/waiver";
import { endOfCalendarDayInTimeZone } from "@/lib/pass-access";

export const dynamic = "force-dynamic";

/** POST — Use one banked day pass for today (app timezone). Body optional: { subscription_id } ignored (legacy). */
export async function POST(request: NextRequest) {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Log in to activate a pass." }, { status: 401 });
  }

  try {
    await request.json().catch(() => ({}));
  } catch {
    /* ignore */
  }

  const db = getDb();
  ensureDayPassCreditLedger(db);
  ensureMembersPassActivationDayColumn(db);
  migrateLegacyPassPackSubscriptionsToLedger(db);
  const tz = getAppTimezone(db);
  const today = todayInAppTz(tz);

  const balance = getMemberDayPassLedgerBalance(db, memberId);
  if (balance <= 0) {
    db.close();
    return NextResponse.json({ error: "No day passes left. Purchase a pass pack to bank more days." }, { status: 400 });
  }

  const memberRow = db
    .prepare("SELECT pass_activation_day, email, first_name, last_name, kisi_id FROM members WHERE member_id = ?")
    .get(memberId) as
    | {
        pass_activation_day: string | null;
        email: string | null;
        first_name: string | null;
        last_name: string | null;
        kisi_id: string | null;
      }
    | undefined;

  if (!memberRow) {
    db.close();
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const activationDay = (memberRow.pass_activation_day ?? "").trim();
  if (activationDay === today) {
    db.close();
    return NextResponse.json({ error: "You already activated a pass for today." }, { status: 400 });
  }

  const insertUse = db.prepare(
    `INSERT INTO day_pass_credit_ledger (member_id, amount, reason, reference_type, reference_id)
     VALUES (?, -1, 'activate', 'day', ?)`
  );

  db.exec("BEGIN");
  try {
    insertUse.run(memberId, today);
    db.prepare("UPDATE members SET pass_activation_day = ? WHERE member_id = ?").run(today, memberId);
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    db.close();
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not activate." }, { status: 500 });
  }

  const remaining = getMemberDayPassLedgerBalance(db, memberId);
  db.close();

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const waiver = await ensureWaiverBeforeKisi(
    memberId,
    { email: memberRow.email ?? null, first_name: memberRow.first_name ?? null },
    origin
  );

  const validUntil = endOfCalendarDayInTimeZone(today, tz);

  if (waiver.shouldGrantKisi && memberRow.email?.trim()) {
    try {
      let kisiId = memberRow.kisi_id?.trim() || null;
      if (!kisiId) {
        const name = [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || undefined;
        kisiId = await ensureKisiUser(memberRow.email.trim(), name);
        const db2 = getDb();
        db2.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, memberId);
        db2.close();
      }
      if (kisiId) {
        await kisiGrantAccess(kisiId, validUntil);
      }
    } catch (e) {
      console.error("[activate-pass-day] Kisi grant failed", e);
    }
  }

  return NextResponse.json({
    ok: true,
    pass_credits_remaining: remaining,
    pass_activation_day: today,
    valid_until: validUntil.toISOString(),
    plan_name: "Day pass",
  });
}
