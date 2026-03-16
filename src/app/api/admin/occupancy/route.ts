import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { addOccupancyEntry, getOccupancyCount, removeOldestOccupancyEntry } from "@/lib/occupancy";

export const dynamic = "force-dynamic";

/** POST { action: "add" | "remove" } — manual +1 (walk-in) or -1 (FIFO). Admin only. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = (body.action ?? "").trim().toLowerCase();

    if (action !== "add" && action !== "remove") {
      return NextResponse.json({ error: "action must be 'add' or 'remove'" }, { status: 400 });
    }

    const db = getDb();

    if (action === "add") {
      addOccupancyEntry(db, "manual");
    } else {
      const removed = removeOldestOccupancyEntry(db);
      if (!removed) {
        db.close();
        return NextResponse.json({ error: "No one to remove (count is 0)" }, { status: 400 });
      }
    }

    const count = getOccupancyCount(db);
    db.close();

    return NextResponse.json({ ok: true, occupancy: count });
  } catch (err) {
    console.error("[admin/occupancy]", err);
    return NextResponse.json({ error: "Failed to update occupancy" }, { status: 500 });
  }
}
