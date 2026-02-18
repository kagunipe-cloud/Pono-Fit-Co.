import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables, getPTCreditBalance } from "../../../../lib/pt-slots";
import { sendStaffEmail } from "../../../../lib/email";

export const dynamic = "force-dynamic";

function parseTimeToMinutes(t: string): number {
  const parts = String(t).trim().split(/[:\s]/).map((x) => parseInt(x, 10));
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return (h % 24) * 60 + m;
}

/** Session end (date + start_time + duration_minutes) is before now? */
function sessionEnded(date: string, startTime: string, durationMinutes: number): boolean {
  const [y, mo, d] = date.split("-").map((x) => parseInt(x, 10));
  const startMin = parseTimeToMinutes(startTime);
  const endMin = startMin + durationMinutes;
  const endDate = new Date(y, mo - 1, d, Math.floor(endMin / 60), endMin % 60, 0);
  return endDate.getTime() < Date.now();
}

/**
 * GET (cron): Process PT open bookings whose session time has passed.
 * - For in-system members: dock 1 credit, set credit_docked=1.
 * - If balance is 0 after (or they had 0 before): email staff to have member re-up.
 * - If balance is 1 after docking: email staff that member has 1 credit left.
 * Guest bookings (no member_id) are skipped (no credit to dock).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("x-cron-secret") !== secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  ensurePTSlotTables(db);

  const rows = db.prepare(`
    SELECT ob.id, ob.member_id, ob.occurrence_date, ob.start_time, ob.duration_minutes, ob.credit_docked
    FROM pt_open_bookings ob
    WHERE ob.member_id != '' AND ob.member_id IS NOT NULL AND (ob.credit_docked IS NULL OR ob.credit_docked = 0)
  `).all() as { id: number; member_id: string; occurrence_date: string; start_time: string; duration_minutes: number; credit_docked: number | null }[];

  const toProcess = rows.filter((r) => sessionEnded(r.occurrence_date, r.start_time, r.duration_minutes));
  const memberNames = new Map<string, string>();
  const members = db.prepare("SELECT member_id, first_name, last_name FROM members").all() as { member_id: string; first_name: string | null; last_name: string | null }[];
  for (const m of members) {
    memberNames.set(m.member_id, [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.member_id);
  }

  let docked = 0;
  const emailsSent: string[] = [];

  for (const row of toProcess) {
    const balanceBefore = getPTCreditBalance(db, row.member_id, row.duration_minutes);
    if (balanceBefore >= 1) {
      db.prepare(
        "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, -1, ?, 'pt_open_booking_after_session', ?)"
      ).run(row.member_id, row.duration_minutes, `PT session completed ${row.occurrence_date} ${row.start_time}`, String(row.id));
      docked++;
    }

    db.prepare("UPDATE pt_open_bookings SET credit_docked = 1 WHERE id = ?").run(row.id);

    const balanceAfter = getPTCreditBalance(db, row.member_id, row.duration_minutes);
    const displayName = memberNames.get(row.member_id) || row.member_id;

    if (balanceAfter === 0) {
      const ok = await sendStaffEmail(
        `PT credits: ${displayName} has no credits left`,
        `${displayName} (${row.member_id}) has no PT credits left for ${row.duration_minutes}-min sessions. Please have them re-up.`
      );
      if (ok) emailsSent.push(`${displayName} (0 credits)`);
    } else if (balanceAfter === 1 && balanceBefore >= 1) {
      const ok = await sendStaffEmail(
        `PT credits: ${displayName} has 1 credit left`,
        `${displayName} (${row.member_id}) has 1 PT credit left for ${row.duration_minutes}-min sessions. Consider reminding them to re-up.`
      );
      if (ok) emailsSent.push(`${displayName} (1 credit)`);
    }
  }

  db.close();

  return NextResponse.json({
    processed: toProcess.length,
    docked,
    emails_sent: emailsSent.length,
    details: emailsSent,
  });
}
