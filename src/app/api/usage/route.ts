import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/db";
import { getMemberIdFromSession } from "../../../lib/session";
import { ensureUsageTables } from "../../../lib/usage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const eventType = typeof body.event_type === "string" ? body.event_type.trim() : "page_view";
    const path = typeof body.path === "string" ? body.path.trim() || null : null;

    const db = getDb();
    ensureUsageTables(db);
    db.prepare(
      "INSERT INTO app_usage_events (member_id, event_type, path) VALUES (?, ?, ?)"
    ).run(memberId, eventType.slice(0, 128), path ? path.slice(0, 512) : null);
    db.close();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[usage]", err);
    return NextResponse.json({ error: "Failed to record usage" }, { status: 500 });
  }
}
