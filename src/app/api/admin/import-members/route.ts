import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { ensureMembersStripeColumn, ensureMembersPasswordColumn } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Parse Glofox "Added" (ISO) to YYYY-MM-DD. */
function parseAdded(added: string | undefined): string | null {
  if (!added?.trim()) return null;
  const s = added.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/** Parse Glofox "Membership Expiry Date" (MM/DD/YYYY) to YYYY-MM-DD. */
function parseExpiry(expiry: string | undefined): string | null {
  if (!expiry?.trim()) return null;
  const parts = expiry.trim().split("/");
  if (parts.length !== 3) return null;
  const [mm, dd, yyyy] = parts;
  if (mm?.length && dd?.length && yyyy?.length) return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  return null;
}

type Row = Record<string, string | undefined>;

/**
 * POST — import members from Glofox CSV (admin only).
 * Body: { csv: string }. Upserts by email (case-insensitive).
 * Required per row: First Name, Last Name, Email. Role defaults to "Member".
 */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let csv = "";
  try {
    const body = await request.json();
    csv = typeof body.csv === "string" ? body.csv : "";
  } catch {
    return NextResponse.json({ error: "Body must be JSON with a 'csv' string." }, { status: 400 });
  }

  if (!csv.trim()) {
    return NextResponse.json({ error: "csv is required" }, { status: 400 });
  }

  let rows: Row[];
  try {
    rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Row[];
  } catch (err) {
    console.error("[import-members] parse error", err);
    return NextResponse.json({ error: "Invalid CSV" }, { status: 400 });
  }

  const db = getDb();
  ensureMembersStripeColumn(db);
  ensureMembersPasswordColumn(db);

  const getByEmail = db.prepare(
    "SELECT id, member_id, first_name, last_name, email, kisi_id FROM members WHERE LOWER(TRIM(email)) = ?"
  );
  const updateMember = db.prepare(
    `UPDATE members SET first_name = ?, last_name = ?, role = ?, join_date = ?, exp_next_payment_date = ?
     WHERE member_id = ?`
  );
  const insertMember = db.prepare(
    `INSERT INTO members (member_id, first_name, last_name, email, role, join_date, exp_next_payment_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { row: number; email: string; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawEmail = (row["Email"] ?? "").trim();
    const emailLower = rawEmail.toLowerCase();
    if (!emailLower) {
      skipped++;
      continue;
    }

    const firstName = (row["First Name"] ?? "").trim() || null;
    const lastName = (row["Last Name"] ?? "").trim() || null;
    const role = "Member";
    const joinDate = parseAdded(row["Added"]) ?? null;
    const expNextPaymentDate = parseExpiry(row["Membership Expiry Date"]) ?? null;

    const existing = getByEmail.get(emailLower) as
      | { id: number; member_id: string; first_name: string | null; last_name: string | null; email: string | null; kisi_id: string | null }
      | undefined;

    try {
      if (existing) {
        updateMember.run(
          firstName ?? existing.first_name,
          lastName ?? existing.last_name,
          role,
          joinDate,
          expNextPaymentDate,
          existing.member_id
        );
        updated++;
      } else {
        const memberId = randomUUID().slice(0, 8);
        insertMember.run(
          memberId,
          firstName,
          lastName,
          rawEmail || emailLower,
          role,
          joinDate,
          expNextPaymentDate
        );
        created++;
      }
    } catch (err) {
      errors.push({ row: i + 2, email: rawEmail || "(blank)", message: String(err) });
    }
  }

  db.close();

  return NextResponse.json({
    created,
    updated,
    skipped,
    total: rows.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
