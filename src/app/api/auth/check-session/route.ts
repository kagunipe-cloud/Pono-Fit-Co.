import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** GET: Returns { ok: boolean, role?: string } for middleware. No redirect. */
export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ ok: false });
    }
    const db = getDb();
    const row = db.prepare("SELECT role FROM members WHERE member_id = ?").get(memberId) as { role: string | null } | undefined;
    db.close();
    const role = row?.role ?? "Member";
    return NextResponse.json({ ok: true, role });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
