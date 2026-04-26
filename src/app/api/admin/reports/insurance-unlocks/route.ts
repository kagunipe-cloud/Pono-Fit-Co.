import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureUsageTables } from "@/lib/usage";
import { dateStringInAppTz, endOfDayInTz, startOfDayInTz } from "@/lib/app-timezone";
import { INSURANCE_PROGRAM_VALUES } from "@/lib/insurance-program";

const PROGRAM_ALL = "all";

export const dynamic = "force-dynamic";

/** Cap on raw door events for this report; first-of-day dedupe needs a full date range if possible. */
const MAX_ROWS = 100_000;

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** GET: Door unlocks for members with a given insurance designation. Admin only.
 * Query: program=all|optum|tivity, from=YYYY-MM-DD, to=YYYY-MM-DD (inclusive, app timezone).
 *  `all` = any member with a non-empty insurance_program.
 * Optional: success_only=0 to include failed attempts (default 1). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const programRaw = (sp.get("program") ?? PROGRAM_ALL).trim().toLowerCase();
  const program = programRaw === "" ? PROGRAM_ALL : programRaw;
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();
  const successOnly = sp.get("success_only") !== "0";

  if (program !== PROGRAM_ALL && !INSURANCE_PROGRAM_VALUES.includes(program as (typeof INSURANCE_PROGRAM_VALUES)[number])) {
    return NextResponse.json({ error: "program must be all, optum, or tivity." }, { status: 400 });
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
    const programClause =
      program === PROGRAM_ALL
        ? "m.insurance_program IS NOT NULL AND LENGTH(TRIM(m.insurance_program)) > 0"
        : "m.insurance_program = ?";

    const query = `SELECT d.id, d.uuid, d.lock_id, d.lock_name, d.success, d.happened_at,
                m.member_id, m.first_name, m.last_name, m.insurance_program
         FROM door_access_events d
         INNER JOIN members m ON m.member_id = d.member_id
         WHERE ${programClause}
           AND d.happened_at >= ?
           AND d.happened_at <= ?
           ${successClause}
         ORDER BY d.happened_at ASC
         LIMIT ?`;

    const rows = (
      program === PROGRAM_ALL
        ? db.prepare(query).all(fromIso, toIso, MAX_ROWS)
        : db.prepare(query).all(program, fromIso, toIso, MAX_ROWS)
    ) as {
      id: number;
      uuid: string | null;
      lock_id: number | null;
      lock_name: string | null;
      success: number;
      happened_at: string;
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      insurance_program: string | null;
    }[];

    db.close();

    const sorted = [...rows].sort(
      (a, b) => new Date(a.happened_at).getTime() - new Date(b.happened_at).getTime()
    );
    const firstPerDayKey = new Set<string>();
    const firstOfDayRows: typeof rows = [];
    for (const r of sorted) {
      const ymd = dateStringInAppTz(r.happened_at, tz);
      const k = `${r.member_id}\t${ymd}`;
      if (firstPerDayKey.has(k)) continue;
      firstPerDayKey.add(k);
      firstOfDayRows.push(r);
    }

    const byMemberAll = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byMemberAll.get(r.member_id) ?? [];
      list.push(r);
      byMemberAll.set(r.member_id, list);
    }
    for (const list of byMemberAll.values()) {
      list.sort((a, b) => new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime());
    }

    const firstsByMember = new Map<string, typeof rows>();
    for (const r of firstOfDayRows) {
      const list = firstsByMember.get(r.member_id) ?? [];
      list.push(r);
      firstsByMember.set(r.member_id, list);
    }
    for (const list of firstsByMember.values()) {
      list.sort((a, b) => new Date(a.happened_at).getTime() - new Date(b.happened_at).getTime());
    }

    const memberIds = Array.from(byMemberAll.keys()).sort((a, b) => {
      const ra = byMemberAll.get(a)![0];
      const rb = byMemberAll.get(b)![0];
      const ln = (ra.last_name ?? "").localeCompare(rb.last_name ?? "", undefined, { sensitivity: "base" });
      if (ln !== 0) return ln;
      return (ra.first_name ?? "").localeCompare(rb.first_name ?? "", undefined, { sensitivity: "base" });
    });

    const members = memberIds.map((member_id) => {
      const all_unlocks = byMemberAll.get(member_id) ?? [];
      const fr = all_unlocks[0];
      const billable_days = firstsByMember.get(member_id)?.length ?? 0;
      return {
        member_id,
        first_name: fr.first_name,
        last_name: fr.last_name,
        insurance_program: fr.insurance_program,
        billable_days,
        all_unlocks,
      };
    });

    return NextResponse.json({
      program,
      from,
      to,
      timezone: tz,
      truncated: rows.length >= MAX_ROWS,
      total_billable_days: firstOfDayRows.length,
      members,
    });
  } catch (err) {
    console.error("[insurance-unlocks report]", err);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
}
