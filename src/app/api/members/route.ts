import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/db";
import { formatInAppTz } from "../../../lib/app-timezone";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim();

  try {
    const db = getDb();
    let rows;
    if (q) {
      const pattern = `%${q.replace(/%/g, "\\%")}%`;
      const stmt = db.prepare(`
        SELECT m.id, m.member_id, m.first_name, m.last_name, m.email, m.kisi_id, m.kisi_group_id, m.join_date,
          COALESCE(m.exp_next_payment_date, (SELECT MAX(s.expiry_date) FROM subscriptions s WHERE s.member_id = m.member_id AND s.status = 'Active')) AS exp_next_payment_date,
          m.role, m.created_at
        FROM members m
        WHERE m.first_name LIKE ? OR m.last_name LIKE ? OR m.email LIKE ? OR m.role LIKE ? OR m.member_id LIKE ?
        ORDER BY m.last_name ASC, m.first_name ASC
      `);
      rows = stmt.all(pattern, pattern, pattern, pattern, pattern);
    } else {
      const stmt = db.prepare(`
        SELECT m.id, m.member_id, m.first_name, m.last_name, m.email, m.kisi_id, m.kisi_group_id, m.join_date,
          COALESCE(m.exp_next_payment_date, (SELECT MAX(s.expiry_date) FROM subscriptions s WHERE s.member_id = m.member_id AND s.status = 'Active')) AS exp_next_payment_date,
          m.role, m.created_at
        FROM members m
        ORDER BY m.last_name ASC, m.first_name ASC
      `);
      rows = stmt.all();
    }
    db.close();
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch members" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const first_name = (body.first_name ?? "").trim() || null;
    const last_name = (body.last_name ?? "").trim() || null;
    const email = (body.email ?? "").trim() || null;
    const role = (body.role ?? "Member").trim() || "Member";

    const db = getDb();
    const member_id = randomUUID().slice(0, 8);
    const join_date = formatInAppTz(new Date(), { month: "numeric", day: "numeric", year: "numeric" });

    const stmt = db.prepare(`
      INSERT INTO members (member_id, first_name, last_name, email, join_date, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(member_id, first_name, last_name, email, join_date, role);
    db.close();

    return NextResponse.json({
      id: result.lastInsertRowid,
      member_id,
      first_name,
      last_name,
      email,
      join_date,
      role,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to create member" },
      { status: 500 }
    );
  }
}
