import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET — public settings (e.g. timezone for schedule/macros). */
export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("timezone") as { value: string } | undefined;
    db.close();
    const timezone = row?.value?.trim() || "Pacific/Honolulu";
    return NextResponse.json({ timezone });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ timezone: "Pacific/Honolulu" });
  }
}
