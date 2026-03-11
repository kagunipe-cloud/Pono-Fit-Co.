import { NextResponse } from "next/server";
import { getMemberIdFromSession } from "@/lib/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST — Record that the logged-in member accepted Privacy Policy and Terms of Service. */
export async function POST() {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  try {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("UPDATE members SET privacy_terms_accepted_at = ? WHERE member_id = ?").run(now, memberId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[accept-privacy-terms]", err);
    return NextResponse.json({ error: "Failed to record acceptance" }, { status: 500 });
  }
}
