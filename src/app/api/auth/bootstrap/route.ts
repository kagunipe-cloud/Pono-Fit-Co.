import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPasswordColumn } from "../../../../lib/db";
import { hashPassword } from "../../../../lib/password";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

/**
 * One-time bootstrap: create the first admin when the DB has no members.
 * Requires BOOTSTRAP_SECRET in env and ?secret=... in the request (query or body).
 */
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.BOOTSTRAP_SECRET?.trim();
    if (!secret || secret.length < 12) {
      return NextResponse.json(
        { error: "Bootstrap not configured (BOOTSTRAP_SECRET must be set, at least 12 characters)." },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const providedSecret = (body.secret ?? url.searchParams.get("secret") ?? "").trim();
    if (providedSecret !== secret) {
      return NextResponse.json({ error: "Invalid bootstrap secret." }, { status: 403 });
    }

    const email = (body.email ?? "").trim().toLowerCase();
    const password = (body.password ?? "").trim();
    const first_name = (body.first_name ?? "").trim() || "Admin";
    const last_name = (body.last_name ?? "").trim() || "";

    if (!email) {
      return NextResponse.json({ error: "Email required." }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const db = getDb();
    ensureMembersPasswordColumn(db);

    const count = db.prepare("SELECT COUNT(*) AS n FROM members").get() as { n: number };
    if (count.n > 0) {
      db.close();
      return NextResponse.json(
        { error: "Bootstrap only runs when there are no members. You already have members—use Login or Set password." },
        { status: 400 }
      );
    }

    const member_id = randomUUID().slice(0, 8);
    const password_hash = hashPassword(password);

    db.prepare(
      `INSERT INTO members (member_id, first_name, last_name, email, role, password_hash)
       VALUES (?, ?, ?, ?, 'Admin', ?)`
    ).run(member_id, first_name, last_name, email, password_hash);
    db.close();

    return NextResponse.json({
      success: true,
      message: "First admin created. You can now sign in with your email and password.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bootstrap failed" },
      { status: 500 }
    );
  }
}
