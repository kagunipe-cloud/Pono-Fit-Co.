import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getAdminMemberId } from "../../../../lib/admin";
import { ensureUsageTables } from "../../../../lib/usage";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;

/** GET: Door and app usage events (admin only). Query: limit (default 200), days (optional, last N days). */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(MAX_LIMIT, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT);
  const daysParam = searchParams.get("days");
  const days = daysParam ? parseInt(daysParam, 10) : null;
  const since = days != null && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ") : null;

  try {
    const db = getDb();
    ensureUsageTables(db);

    const doorRows = since
      ? db.prepare(
          `SELECT d.id, d.uuid, d.member_id, d.kisi_actor_id, d.kisi_actor_name, d.lock_id, d.lock_name, d.success, d.happened_at, d.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM door_access_events d
           LEFT JOIN members m ON m.member_id = d.member_id
           WHERE d.happened_at >= ? ORDER BY d.happened_at DESC LIMIT ?`
        ).all(since, limit)
      : db.prepare(
          `SELECT d.id, d.uuid, d.member_id, d.kisi_actor_id, d.kisi_actor_name, d.lock_id, d.lock_name, d.success, d.happened_at, d.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM door_access_events d
           LEFT JOIN members m ON m.member_id = d.member_id
           ORDER BY d.happened_at DESC LIMIT ?`
        ).all(limit);

    const appRows = since
      ? db.prepare(
          `SELECT a.id, a.member_id, a.event_type, a.path, a.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM app_usage_events a
           LEFT JOIN members m ON m.member_id = a.member_id
           WHERE a.created_at >= ? ORDER BY a.created_at DESC LIMIT ?`
        ).all(since, limit)
      : db.prepare(
          `SELECT a.id, a.member_id, a.event_type, a.path, a.created_at,
            TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
           FROM app_usage_events a
           LEFT JOIN members m ON m.member_id = a.member_id
           ORDER BY a.created_at DESC LIMIT ?`
        ).all(limit);

    db.close();

    return NextResponse.json({
      door: doorRows as Record<string, unknown>[],
      app: appRows as Record<string, unknown>[],
    });
  } catch (err) {
    console.error("[admin/usage]", err);
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 });
  }
}
