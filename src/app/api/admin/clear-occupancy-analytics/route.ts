import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTrainerMemberId } from "@/lib/admin";
import { ensureOccupancyTable, ensureOccupancySnapshotsTable } from "@/lib/occupancy";
import { ensureUsageTables } from "@/lib/usage";

export const dynamic = "force-dynamic";

/**
 * POST — Admin or Trainer. Deletes all Coconut Count rows, occupancy snapshot history, and door webhook history
 * (used for analytics / Check-Ins). Irreversible.
 */
export async function POST(_request: NextRequest) {
  const staffId = await getTrainerMemberId(_request);
  if (!staffId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    ensureOccupancyTable(db);
    ensureOccupancySnapshotsTable(db);
    ensureUsageTables(db);

    db.prepare("DELETE FROM occupancy_entries").run();
    db.prepare("DELETE FROM occupancy_snapshots").run();
    db.prepare("DELETE FROM door_access_events").run();
    db.close();

    return NextResponse.json({
      ok: true,
      cleared: ["occupancy_entries", "occupancy_snapshots", "door_access_events"] as const,
    });
  } catch (err) {
    console.error("[clear-occupancy-analytics]", err);
    return NextResponse.json({ error: "Failed to clear data" }, { status: 500 });
  }
}
