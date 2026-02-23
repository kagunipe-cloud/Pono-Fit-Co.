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
          `SELECT id, uuid, member_id, kisi_actor_id, kisi_actor_name, lock_id, lock_name, success, happened_at, created_at
           FROM door_access_events WHERE happened_at >= ? ORDER BY happened_at DESC LIMIT ?`
        ).all(since, limit)
      : db.prepare(
          `SELECT id, uuid, member_id, kisi_actor_id, kisi_actor_name, lock_id, lock_name, success, happened_at, created_at
           FROM door_access_events ORDER BY happened_at DESC LIMIT ?`
        ).all(limit);

    const appRows = since
      ? db.prepare(
          `SELECT id, member_id, event_type, path, created_at
           FROM app_usage_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`
        ).all(since, limit)
      : db.prepare(
          `SELECT id, member_id, event_type, path, created_at
           FROM app_usage_events ORDER BY created_at DESC LIMIT ?`
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
