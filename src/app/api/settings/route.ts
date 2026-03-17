import { NextResponse } from "next/server";
import { getDb, getOpenHours } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET — public settings (e.g. timezone, open hours for schedule/analytics). */
export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("timezone") as { value: string } | undefined;
    const { openHourMin, openHourMax } = getOpenHours(db);
    db.close();
    const timezone = row?.value?.trim() || "Pacific/Honolulu";
    return NextResponse.json({ timezone, open_hour_min: openHourMin, open_hour_max: openHourMax });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ timezone: "Pacific/Honolulu", open_hour_min: 6, open_hour_max: 22 });
  }
}
