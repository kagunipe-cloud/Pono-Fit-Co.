import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOccupancyCount } from "@/lib/occupancy";

export const dynamic = "force-dynamic";

/** GET — live occupancy count from app DB (KISI + manual ±1, 1hr auto-exit). */
export async function GET() {
  try {
    const db = getDb();
    const count = getOccupancyCount(db);
    db.close();
    return NextResponse.json({ occupancy: count });
  } catch (err) {
    console.error("Occupancy fetch error:", err);
    return NextResponse.json({ occupancy: null, error: "Failed to fetch" }, { status: 502 });
  }
}
