import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersDoorAccessWaiverExemptColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  FIXABLE_KISI_SYNC_STATUSES,
  fixMemberKisiAccessIfNeeded,
  reconcileKisiDoorAccess,
} from "@/lib/kisi-access-reconcile";
import { runKisiAccessAudit, auditOneMemberKisiAccess, countMembersForKisiAudit } from "@/lib/kisi-access-audit";

const FIXABLE = FIXABLE_KISI_SYNC_STATUSES;

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET — Compare app door access vs Kisi role assignments.
 * Query: mismatches_only=1, offset=0, limit=50, member_id=abc (optional single member)
 */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mismatchesOnly = searchParams.get("mismatches_only") === "1" || searchParams.get("mismatches_only") === "true";
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const singleMemberId = searchParams.get("member_id")?.trim() || null;

  const db = getDb();
  ensureMembersDoorAccessWaiverExemptColumn(db);
  const tz = getAppTimezone(db);

  if (singleMemberId) {
    const row = db
      .prepare(
        `SELECT member_id, email, first_name, last_name, kisi_id, waiver_signed_at,
                door_access_waiver_exempt, pass_activation_day
         FROM members WHERE member_id = ?`
      )
      .get(singleMemberId) as
      | {
          member_id: string;
          email: string | null;
          first_name: string | null;
          last_name: string | null;
          kisi_id: string | null;
          waiver_signed_at: string | null;
          door_access_waiver_exempt: number | null;
          pass_activation_day: string | null;
        }
      | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const audit = await auditOneMemberKisiAccess(db, tz, row);
    db.close();
    return NextResponse.json({ ok: true, row: audit });
  }

  const totalMembers = countMembersForKisiAudit(db);
  const result = await runKisiAccessAudit(db, tz, {
    mismatches_only: mismatchesOnly,
    lookup_kisi_by_email: true,
    limit,
    offset,
  });
  db.close();

  const mismatchByStatus: Record<string, number> = {};
  for (const m of result.mismatches) {
    mismatchByStatus[m.sync_status] = (mismatchByStatus[m.sync_status] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    description:
      "Compares who should have door access in the app today vs active Kisi role in KISI_GROUP_ID. " +
      "Use POST to re-grant fixable mismatches (missing/expired role, missing kisi user when waiver is complete).",
    ...result,
    pagination: {
      offset,
      limit,
      members_with_email_total: totalMembers,
      has_more: offset + result.members_scanned < totalMembers,
      next_offset: offset + result.members_scanned < totalMembers ? offset + limit : null,
    },
    mismatch_by_status: mismatchByStatus,
    common_fixes: {
      waiver_blocked: "Member signs waiver in app, or admin sets door_access_waiver_exempt for legacy imports.",
      missing_kisi_user: "POST fix here, or migration-grant-kisi with lookup_kisi_by_email.",
      missing_role: "POST fix — runs grantAccess with app subscription valid_until.",
      expired_role: "POST fix — same as missing_role.",
      pass_not_activated: "Member taps Activate pass for today on My Membership.",
      open_payment_failures: "Resolve in Money owed — failed renewal revokes Kisi.",
    },
  });
}

/**
 * POST — Re-grant Kisi for members who are active in app but missing Kisi access.
 * Body: { member_ids: string[] } or { fix_all_mismatches: true, offset?, limit? }
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.KISI_API_KEY?.trim() || !process.env.KISI_GROUP_ID?.trim()) {
    return NextResponse.json({ error: "KISI_API_KEY and KISI_GROUP_ID must be set." }, { status: 500 });
  }

  let body: { member_ids?: string[]; fix_all_mismatches?: boolean; offset?: number; limit?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const db = getDb();
  ensureMembersDoorAccessWaiverExemptColumn(db);
  const tz = getAppTimezone(db);

  let memberIds = (body.member_ids ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (body.fix_all_mismatches) {
    const audit = await runKisiAccessAudit(db, tz, {
      mismatches_only: true,
      lookup_kisi_by_email: true,
      limit: Math.min(100, body.limit ?? 40),
      offset: body.offset ?? 0,
    });
    memberIds = audit.mismatches.filter((m) => FIXABLE.includes(m.sync_status)).map((m) => m.member_id);
  }

  if (memberIds.length === 0) {
    db.close();
    return NextResponse.json({ error: "No member_ids to fix (or no fixable mismatches in batch)." }, { status: 400 });
  }

  const batch = await reconcileKisiDoorAccess(db, tz, memberIds);
  db.close();

  return NextResponse.json({
    ok: true,
    fixed_count: batch.fixed.length,
    skipped_count: batch.skipped.length,
    error_count: batch.errors.length,
    fixed: batch.fixed.length ? batch.fixed.map((f) => ({ member_id: f.member_id, kisi_id: f.kisi_id })) : undefined,
    skipped: batch.skipped.length ? batch.skipped : undefined,
    errors: batch.errors.length ? batch.errors : undefined,
  });
}
