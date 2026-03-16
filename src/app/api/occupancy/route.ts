import { NextResponse } from "next/server";

const OCCUPANCY_SCRIPT_URL =
  process.env.OCCUPANCY_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbwVcaDjtjJQvk0E89ZSOVx8mKRcaK8x5_r3RKy61GL83pgCjNtW846Gw_rSLCDD54Ar/exec";

export const dynamic = "force-dynamic";

/** GET — fetches live occupancy count from Google Apps Script (spreadsheet). */
export async function GET() {
  try {
    const res = await fetch(OCCUPANCY_SCRIPT_URL, {
      next: { revalidate: 0 },
      headers: { "Cache-Control": "no-store" },
    });
    const data = (await res.json()) as { occupancy?: number | string };
    const n = typeof data.occupancy === "number" ? data.occupancy : parseInt(String(data.occupancy ?? 0), 10);
    return NextResponse.json({ occupancy: isNaN(n) ? 0 : n });
  } catch (err) {
    console.error("Occupancy fetch error:", err);
    return NextResponse.json({ occupancy: null, error: "Failed to fetch" }, { status: 502 });
  }
}
