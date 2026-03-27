import { NextRequest, NextResponse } from "next/server";
import { getDb, getOpenHours } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET — admin: full settings. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("timezone") as { value: string } | undefined;
    const hiddenRow = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("onboarding_nav_hidden") as { value: string } | undefined;
    const { openHourMin, openHourMax } = getOpenHours(db);
    db.close();
    const timezone = row?.value?.trim() || "Pacific/Honolulu";
    const onboardingNavHidden = hiddenRow?.value?.trim() === "1";
    return NextResponse.json({ timezone, open_hour_min: openHourMin, open_hour_max: openHourMax, onboarding_nav_hidden: onboardingNavHidden });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

/** PATCH — admin: update settings. Body: { timezone?, open_hour_min?, open_hour_max?, onboarding_nav_hidden? }. */
export async function PATCH(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const onboardingNavHidden =
      typeof body.onboarding_nav_hidden === "boolean" ? body.onboarding_nav_hidden : null;
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : null;
    if (timezone === "") {
      return NextResponse.json({ error: "timezone cannot be empty" }, { status: 400 });
    }
    const openHourMin = typeof body.open_hour_min === "number" ? body.open_hour_min : null;
    const openHourMax = typeof body.open_hour_max === "number" ? body.open_hour_max : null;
    if (openHourMin !== null && (openHourMin < 0 || openHourMin > 23)) {
      return NextResponse.json({ error: "open_hour_min must be 0–23" }, { status: 400 });
    }
    if (openHourMax !== null && (openHourMax < 0 || openHourMax > 23)) {
      return NextResponse.json({ error: "open_hour_max must be 0–23" }, { status: 400 });
    }

    const db = getDb();
    if (onboardingNavHidden !== null) {
      db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
        "onboarding_nav_hidden",
        onboardingNavHidden ? "1" : "0"
      );
    }
    if (timezone !== null) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        db.close();
        return NextResponse.json({ error: "Invalid timezone (use IANA e.g. America/New_York)" }, { status: 400 });
      }
      db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("timezone", timezone);
    }
    if (openHourMin !== null) {
      db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("open_hour_min", String(openHourMin));
    }
    if (openHourMax !== null) {
      db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("open_hour_max", String(openHourMax));
    }
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
