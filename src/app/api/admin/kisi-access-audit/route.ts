import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, ensureMembersDoorAccessWaiverExemptColumn } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { reconcileKisiDoorAccess } from "@/lib/kisi-access-reconcile";
import {
  runKisiAccessAudit,
  auditOneMemberKisiAccess,
  countMembersForKisiAudit,
  listMemberIdsForKisiAuditScope,
} from "@/lib/kisi-access-audit";

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
  const scopeParam = searchParams.get("scope")?.trim();
  const scope =
    scopeParam === "all" ? "all" : scopeParam === "active_door" ? "active_in_app" : "active_in_app";

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

  const totalMembers = countMembersForKisiAudit(db, tz, scope);
  const result = await runKisiAccessAudit(db, tz, {
    mismatches_only: mismatchesOnly,
    lookup_kisi_by_email: true,
    limit,
    offset,
    scope,
  });
  db.close();

  const mismatchByStatus: Record<string, number> = {};
  for (const m of result.mismatches) {
    mismatchByStatus[m.sync_status] = (mismatchByStatus[m.sync_status] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    description:
      scope === "active_in_app"
        ? "List comes from Active door memberships in the app (our DB). Each member is then checked against Kisi — not the other way around. Inactive/expired imports are skipped."
        : "Full scan of every member with email vs Kisi (slow — use only if needed).",
    scope,
    members_in_scope: result.members_in_scope,
    members_scanned: result.members_scanned,
    in_sync: result.in_sync,
    mismatches: result.mismatches,
    rows: result.rows,
    today_ymd: result.today_ymd,
    timezone: result.timezone,
    kisi_configured: result.kisi_configured,
    pagination: {
      offset,
      limit,
      members_in_scope: totalMembers,
      members_with_email_total: scope === "all" ? totalMembers : undefined,
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
    const batchOffset = body.offset ?? 0;
    const batchLimit = Math.min(100, body.limit ?? 40);
    memberIds = listMemberIdsForKisiAuditScope(db, tz).slice(batchOffset, batchOffset + batchLimit);
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
