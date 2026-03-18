import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { getAdminMemberId } from "../../../../../lib/admin";
import { ensureUsageTables } from "../../../../../lib/usage";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** GET: Recent door unlocks for a member. Admin only. Query: limit (default 10). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = (await params).id;
  if (!id || id.length < 2) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(
    MAX_LIMIT,
    parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT
  );

  try {
    const db = getDb();
    ensureUsageTables(db);

    const isPurelyNumeric = /^\d+$/.test(id);
    const member = (isPurelyNumeric
      ? db.prepare("SELECT member_id FROM members WHERE id = ? OR member_id = ?").get(parseInt(id, 10), id)
      : db.prepare("SELECT member_id FROM members WHERE member_id = ?").get(id)) as { member_id: string } | undefined;

    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const mid = member.member_id;

    const rows = db.prepare(
      `SELECT d.id, d.uuid, d.lock_id, d.lock_name, d.success, d.happened_at
       FROM door_access_events d
       WHERE d.member_id = ?
       ORDER BY d.happened_at DESC
       LIMIT ?`
    ).all(mid, limit) as Record<string, unknown>[];

    db.close();

    return NextResponse.json({ unlocks: rows });
  } catch (err) {
    console.error("[members unlocks]", err);
    return NextResponse.json({ error: "Failed to load unlocks" }, { status: 500 });
  }
}
