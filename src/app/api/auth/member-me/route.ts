import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { getMemberIdFromSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const db = getDb();
    const member = db.prepare(
      "SELECT member_id, first_name, last_name, email, role FROM members WHERE member_id = ?"
    ).get(memberId) as { member_id: string; first_name: string | null; last_name: string | null; email: string | null; role: string | null } | undefined;
    db.close();

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 401 });
    }

    return NextResponse.json({
      member_id: member.member_id,
      email: member.email,
      first_name: member.first_name,
      last_name: member.last_name,
      name: [member.first_name, member.last_name].filter(Boolean).join(" ") || "Member",
      role: member.role ?? "Member",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
