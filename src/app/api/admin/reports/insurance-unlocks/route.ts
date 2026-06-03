import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersInsuranceFitnessIdColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureUsageTables } from "@/lib/usage";
import { endOfDayInTz, startOfDayInTz } from "@/lib/app-timezone";
import {
  isValidInsuranceReportFilter,
  type InsuranceReportFilter,
} from "@/lib/insurance-program";
import { loadInsuranceUnlocksReport } from "@/lib/insurance-unlocks-report";

export const dynamic = "force-dynamic";

/** Cap on raw door events for this report; first-of-day dedupe needs a full date range if possible. */
const MAX_ROWS = 100_000;

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** GET: Door unlocks for members with a given insurance designation. Admin only.
 * Query: program=all|optum|tivity|ash, from=YYYY-MM-DD, to=YYYY-MM-DD (inclusive, app timezone).
 *  `all` = any member with a non-empty insurance_program.
 *  `ash` = Silver & Fit + Active & Fit (ASH).
 * Optional: success_only=0 to include failed attempts (default 1). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const programRaw = (sp.get("program") ?? "all").trim().toLowerCase();
  const program = (programRaw === "" ? "all" : programRaw) as InsuranceReportFilter;
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();
  const successOnly = sp.get("success_only") !== "0";

  if (!isValidInsuranceReportFilter(program)) {
    return NextResponse.json({ error: "program must be all, optum, tivity, or ash." }, { status: 400 });
  }
  if (!from || !to || !isYmd(from) || !isYmd(to)) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureMembersInsuranceFitnessIdColumn(db);
    ensureUsageTables(db);
    const tz = getAppTimezone(db);
    const fromIso = startOfDayInTz(from, tz) + "Z";
    const toIso = endOfDayInTz(to, tz) + "Z";

    const report = loadInsuranceUnlocksReport(db, {
      program,
      fromIso,
      toIso,
      timezone: tz,
      successOnly,
    });

    db.close();

    const members = report.members.map(({ billable_visits: _bv, ...rest }) => rest);

    return NextResponse.json({
      program,
      from,
      to,
      timezone: tz,
      truncated: report.truncated,
      total_billable_days: report.totalBillableDays,
      members,
    });
  } catch (err) {
    console.error("[insurance-unlocks report]", err);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
}
