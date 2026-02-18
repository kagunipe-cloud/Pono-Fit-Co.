import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { createLoginForUser, unlockWithUserSecret } from "../../../../lib/kisi";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const emailProvided = (body.email ?? "").trim();
    if (!member_id) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }

    const db = getDb();
    const member = db.prepare(
      "SELECT email FROM members WHERE member_id = ?"
    ).get(member_id) as { email: string | null } | undefined;
    db.close();

    if (!member?.email?.trim()) {
      return NextResponse.json(
        { error: "Member not found or has no email. Cannot unlock." },
        { status: 400 }
      );
    }
    if (emailProvided && member.email && emailProvided.toLowerCase() !== member.email.toLowerCase()) {
      return NextResponse.json(
        { error: "Email does not match this member." },
        { status: 403 }
      );
    }

    const secret = await createLoginForUser(member.email);
    await unlockWithUserSecret(secret);

    return NextResponse.json({ success: true, message: "Door unlocked." });
  } catch (err) {
    console.error("[Kisi unlock]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unlock failed" },
      { status: 500 }
    );
  }
}
