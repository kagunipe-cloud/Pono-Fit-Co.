import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersInsuranceFitnessIdColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureUsageTables } from "@/lib/usage";
import { endOfDayInTz, startOfDayInTz } from "@/lib/app-timezone";
import { buildAshBulkClaimsTsv } from "@/lib/ash-bulk-claims-export";
import { loadInsuranceUnlocksReport } from "@/lib/insurance-unlocks-report";

export const dynamic = "force-dynamic";

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** GET: ASH Single Location bulk claims file (tab-separated). Admin only.
 * Query: from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, gym timezone).
 * Includes Silver & Fit and Active & Fit members only. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();

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
      program: "ash",
      fromIso,
      toIso,
      timezone: tz,
      successOnly: true,
    });

    db.close();

    const { tsv, exportedRows, skippedMissingFitnessId, skippedMissingBirthday } = buildAshBulkClaimsTsv(
      report.billableVisits,
      tz
    );

    const filename = `ash-bulk-claims_${from}_to_${to}.tsv`;
    return new NextResponse(tsv, {
      status: 200,
      headers: {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Ash-Exported-Rows": String(exportedRows),
        "X-Ash-Skipped-Missing-Fitness-Id": String(skippedMissingFitnessId),
        "X-Ash-Skipped-Missing-Birthday": String(skippedMissingBirthday),
      },
    });
  } catch (err) {
    console.error("[insurance-ash-export]", err);
    return NextResponse.json({ error: "Failed to export ASH bulk claims file" }, { status: 500 });
  }
}
