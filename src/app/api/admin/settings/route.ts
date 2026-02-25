import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET — admin: full settings. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("timezone") as { value: string } | undefined;
    db.close();
    const timezone = row?.value?.trim() || "Pacific/Honolulu";
    return NextResponse.json({ timezone });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

/** PATCH — admin: update settings. Body: { timezone?: string }. */
export async function PATCH(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : null;
    if (timezone === "") {
      return NextResponse.json({ error: "timezone cannot be empty" }, { status: 400 });
    }
    if (timezone !== null) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        return NextResponse.json({ error: "Invalid timezone (use IANA e.g. America/New_York)" }, { status: 400 });
      }
      const db = getDb();
      db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("timezone", timezone);
      db.close();
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
