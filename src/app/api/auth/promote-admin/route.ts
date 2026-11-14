import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersAccountDeletedAtColumn } from "../../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * Emergency: restore Admin role when locked out (e.g. role changed in DB).
 * Requires BOOTSTRAP_SECRET (same as /api/auth/bootstrap). Identify member by email or member_id.
 */
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.BOOTSTRAP_SECRET?.trim();
    if (!secret || secret.length < 12) {
      return NextResponse.json(
        { error: "Not configured (BOOTSTRAP_SECRET must be set, at least 12 characters)." },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const providedSecret = String(body.secret ?? "").trim();
    if (providedSecret !== secret) {
      return NextResponse.json({ error: "Invalid secret." }, { status: 403 });
    }

    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const member_id = String(body.member_id ?? "").trim();
    if (!email && !member_id) {
      return NextResponse.json({ error: "Provide email or member_id." }, { status: 400 });
    }

    const db = getDb();
    ensureMembersAccountDeletedAtColumn(db);

    const row = (
      email
        ? db
            .prepare(
              `SELECT id, member_id, first_name, last_name, email, role, account_deleted_at
               FROM members WHERE LOWER(TRIM(IFNULL(email, ''))) = ?`
            )
            .get(email)
        : db
            .prepare(
              `SELECT id, member_id, first_name, last_name, email, role, account_deleted_at
               FROM members WHERE member_id = ?`
            )
            .get(member_id)
    ) as
      | {
          id: number;
          member_id: string;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          role: string | null;
          account_deleted_at: string | null;
        }
      | undefined;

    if (!row) {
      db.close();
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }

    db.prepare(`UPDATE members SET role = 'Admin' WHERE id = ?`).run(row.id);
    const updated = db
      .prepare(`SELECT member_id, email, role, account_deleted_at FROM members WHERE id = ?`)
      .get(row.id) as {
      member_id: string;
      email: string | null;
      role: string | null;
      account_deleted_at: string | null;
    };
    db.close();

    return NextResponse.json({
      success: true,
      message:
        "Role set to Admin. Sign out and sign in again in a web browser (not the installed app) to open the admin dashboard.",
      member: {
        member_id: updated.member_id,
        email: updated.email,
        role: updated.role,
        account_closed: Boolean((updated.account_deleted_at ?? "").trim()),
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Promote failed" },
      { status: 500 }
    );
  }
}
