import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureUsageTables } from "@/lib/usage";
import { endOfDayInTz, startOfDayInTz } from "@/lib/app-timezone";
import { INSURANCE_PROGRAM_VALUES } from "@/lib/insurance-program";

export const dynamic = "force-dynamic";

const MAX_ROWS = 8000;

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** GET: Door unlocks for members with a given insurance designation (Optum / Tivity). Admin only.
 * Query: program=optum|tivity, from=YYYY-MM-DD, to=YYYY-MM-DD (inclusive, app timezone).
 * Optional: success_only=0 to include failed attempts (default 1). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const program = (sp.get("program") ?? "").trim().toLowerCase();
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();
  const successOnly = sp.get("success_only") !== "0";

  if (!INSURANCE_PROGRAM_VALUES.includes(program as (typeof INSURANCE_PROGRAM_VALUES)[number])) {
    return NextResponse.json({ error: "program must be optum or tivity." }, { status: 400 });
  }
  if (!from || !to || !isYmd(from) || !isYmd(to)) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureUsageTables(db);
    const tz = getAppTimezone(db);
    const fromIso = startOfDayInTz(from, tz) + "Z";
    const toIso = endOfDayInTz(to, tz) + "Z";

    const successClause = successOnly ? "AND d.success = 1" : "";

    const rows = db
      .prepare(
        `SELECT d.id, d.uuid, d.lock_id, d.lock_name, d.success, d.happened_at,
                m.member_id, m.first_name, m.last_name, m.insurance_program
         FROM door_access_events d
         INNER JOIN members m ON m.member_id = d.member_id
         WHERE m.insurance_program = ?
           AND d.happened_at >= ?
           AND d.happened_at <= ?
           ${successClause}
         ORDER BY d.happened_at DESC
         LIMIT ?`
      )
      .all(program, fromIso, toIso, MAX_ROWS) as Record<string, unknown>[];

    db.close();

    return NextResponse.json({
      rows,
      program,
      from,
      to,
      timezone: tz,
      truncated: rows.length >= MAX_ROWS,
    });
  } catch (err) {
    console.error("[insurance-unlocks report]", err);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
}
