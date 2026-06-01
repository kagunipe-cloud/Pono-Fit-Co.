import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersAccountDeletedAtColumn } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { getTrainerMemberId, getAdminMemberId } from "@/lib/admin";

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

/** GET ?q=&scope=clients — search gym members by name or email. scope=clients limits trainers to their PT clients. */
export async function GET(request: NextRequest) {
  try {
    const memberId = await getMemberIdFromSession();
    if (!memberId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const scope = (request.nextUrl.searchParams.get("scope") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json([]);
    }

    const db = getDb();
    ensureMembersAccountDeletedAtColumn(db);
    const pattern = `%${q.replace(/%/g, "\\%")}%`;

    const trainerId = await getTrainerMemberId(request);
    const adminId = await getAdminMemberId(request);
    const clientsOnly = scope === "clients" && trainerId && !adminId;

    let rows: {
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
      email: string | null;
    }[];

    if (clientsOnly) {
      rows = db
        .prepare(
          `SELECT m.member_id, m.first_name, m.last_name, m.preferred_name, m.email
           FROM trainer_clients tc
           JOIN members m ON m.member_id = tc.client_member_id
           WHERE tc.trainer_member_id = ?
             AND (m.account_deleted_at IS NULL OR TRIM(COALESCE(m.account_deleted_at, '')) = '')
             AND TRIM(COALESCE(m.email, '')) != ''
             AND m.member_id != ?
             AND (
               m.first_name LIKE ? COLLATE NOCASE
               OR m.last_name LIKE ? COLLATE NOCASE
               OR m.preferred_name LIKE ? COLLATE NOCASE
               OR m.email LIKE ? COLLATE NOCASE
               OR m.member_id LIKE ? COLLATE NOCASE
             )
           ORDER BY m.last_name COLLATE NOCASE ASC, m.first_name COLLATE NOCASE ASC
           LIMIT 20`
        )
        .all(trainerId, memberId, pattern, pattern, pattern, pattern, pattern) as typeof rows;
    } else {
      rows = db
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
        .all(memberId, pattern, pattern, pattern, pattern, pattern) as typeof rows;
    }

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
