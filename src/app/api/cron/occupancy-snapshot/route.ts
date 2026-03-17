import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordOccupancySnapshot } from "@/lib/occupancy";

export const dynamic = "force-dynamic";

/** GET (cron): Record current occupancy for analytics. Run every 15 min. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get("x-cron-secret") !== secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    recordOccupancySnapshot(db);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[occupancy-snapshot]", err);
    return NextResponse.json({ error: "Failed to record snapshot" }, { status: 500 });
  }
}
