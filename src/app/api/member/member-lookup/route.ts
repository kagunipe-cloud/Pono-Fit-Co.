import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersAccountDeletedAtColumn } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function memberDisplayName(row: {
  preferred_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  const preferred = String(row.preferred_name ?? "").trim();
  if (preferred) return preferred;
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Member";
}

/** GET ?q= — search gym members by name or email (for send-to-member flows). Logged-in members only. */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json([]);
    }

    const db = getDb();
    ensureMembersAccountDeletedAtColumn(db);
    const pattern = `%${q.replace(/%/g, "\\%")}%`;

    const rows = db
      .prepare(
        `SELECT member_id, first_name, last_name, preferred_name, email
         FROM members
         WHERE (account_deleted_at IS NULL OR TRIM(COALESCE(account_deleted_at, '')) = '')
           AND TRIM(COALESCE(email, '')) != ''
           AND member_id != ?
           AND (
             first_name LIKE ? COLLATE NOCASE
             OR last_name LIKE ? COLLATE NOCASE
             OR preferred_name LIKE ? COLLATE NOCASE
             OR email LIKE ? COLLATE NOCASE
             OR member_id LIKE ? COLLATE NOCASE
           )
         ORDER BY last_name COLLATE NOCASE ASC, first_name COLLATE NOCASE ASC
         LIMIT 20`
      )
      .all(memberId, pattern, pattern, pattern, pattern, pattern) as {
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
      email: string | null;
    }[];

    db.close();

    return NextResponse.json(
      rows.map((r) => ({
        member_id: r.member_id,
        display_name: memberDisplayName(r),
        email: String(r.email ?? "").trim(),
      }))
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to search members" }, { status: 500 });
  }
}
