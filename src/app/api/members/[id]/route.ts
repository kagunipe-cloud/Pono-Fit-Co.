import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensurePTSlotTables } from "../../../../lib/pt-slots";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId) && id.length < 2) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  try {
    const db = getDb();

    const memberStmt = db.prepare(`
      SELECT m.id, m.member_id, m.first_name, m.last_name, m.email, m.kisi_id, m.kisi_group_id, m.join_date,
        COALESCE(m.exp_next_payment_date, (SELECT MAX(s.expiry_date) FROM subscriptions s WHERE s.member_id = m.member_id AND s.status = 'Active')) AS exp_next_payment_date,
        m.role, m.created_at
      FROM members m WHERE m.id = ? OR m.member_id = ?
    `);
    const member = memberStmt.get(numericId, id) as Record<string, unknown> | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const mid = member.member_id as string;

    const subscriptions = db.prepare(`
      SELECT s.*, p.plan_name, p.price as plan_price
      FROM subscriptions s
      LEFT JOIN membership_plans p ON p.product_id = s.product_id
      WHERE s.member_id = ?
      ORDER BY s.start_date DESC
    `).all(mid) as Record<string, unknown>[];

    const classBookings = db.prepare(`
      SELECT b.*, c.class_name, c.date as class_date, c.time as class_time
      FROM class_bookings b
      LEFT JOIN classes c ON c.product_id = b.product_id
      WHERE b.member_id = ?
      ORDER BY b.booking_date DESC
    `).all(mid) as Record<string, unknown>[];

    let ptBookings: Record<string, unknown>[] = [];
    try {
      ptBookings = db.prepare(`
        SELECT b.*, p.session_name, p.date_time as session_date
        FROM pt_bookings b
        LEFT JOIN pt_sessions p ON p.product_id = b.product_id
        WHERE b.member_id = ?
        ORDER BY b.booking_date DESC
      `).all(mid) as Record<string, unknown>[];
    } catch {
      /* pt_bookings table may not exist */
    }

    ensurePTSlotTables(db);
    const ptSlotBookings = db.prepare(`
      SELECT b.id, b.member_id, p.session_name, p.date_time as session_date
      FROM pt_slot_bookings b
      LEFT JOIN pt_sessions p ON p.id = b.pt_session_id
      WHERE b.member_id = ?
      ORDER BY p.date_time DESC
    `).all(mid) as Record<string, unknown>[];
    const ptBlockBookings = db.prepare(`
      SELECT b.id, b.occurrence_date, b.start_time, b.session_duration_minutes, a.trainer
      FROM pt_block_bookings b
      JOIN trainer_availability a ON a.id = b.trainer_availability_id
      WHERE b.member_id = ?
      ORDER BY b.occurrence_date DESC, b.start_time DESC
    `).all(mid) as Record<string, unknown>[];

    const sales = db.prepare(`
      SELECT * FROM sales WHERE member_id = ? ORDER BY date_time DESC
    `).all(mid) as Record<string, unknown>[];

    db.close();

    return NextResponse.json({
      member,
      subscriptions,
      classBookings,
      ptBookings,
      ptSlotBookings,
      ptBlockBookings,
      sales,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch member" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];

    const fields = [
      "first_name",
      "last_name",
      "email",
      "kisi_id",
      "kisi_group_id",
      "join_date",
      "exp_next_payment_date",
      "role",
    ] as const;
    for (const field of fields) {
      if (body[field] !== undefined) {
        const val = typeof body[field] === "string" ? body[field].trim() || null : body[field];
        if (field === "email" && (val == null || val === "")) {
          return NextResponse.json(
            { error: "Email is required. It is used for login and Kisi door access." },
            { status: 400 }
          );
        }
        updates.push(`${field} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    values.push(numericId);

    const db = getDb();
    const stmt = db.prepare(`
      UPDATE members SET ${updates.join(", ")} WHERE id = ?
    `);
    stmt.run(...values);
    const row = db.prepare(
      "SELECT id, member_id, first_name, last_name, email, kisi_id, kisi_group_id, join_date, exp_next_payment_date, role, created_at FROM members WHERE id = ?"
    ).get(numericId);
    db.close();

    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update member" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  try {
    const db = getDb();
    const member = db.prepare("SELECT member_id FROM members WHERE id = ?").get(numericId) as { member_id: string } | undefined;
    if (!member) {
      db.close();
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const mid = member.member_id;

    const hasSubs = (db.prepare("SELECT 1 FROM subscriptions WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    const hasSales = (db.prepare("SELECT 1 FROM sales WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    const hasClass = (db.prepare("SELECT 1 FROM class_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    let hasPt = (db.prepare("SELECT 1 FROM pt_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    try {
      ensurePTSlotTables(db);
      if (!hasPt) hasPt = (db.prepare("SELECT 1 FROM pt_slot_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
      if (!hasPt) hasPt = (db.prepare("SELECT 1 FROM pt_block_bookings WHERE member_id = ? LIMIT 1").get(mid) as unknown) != null;
    } catch {
      /* ignore */
    }
    if (hasSubs || hasSales || hasClass || hasPt) {
      db.close();
      return NextResponse.json(
        { error: "Cannot delete member with subscriptions, bookings, or sales. Remove those first." },
        { status: 409 }
      );
    }

    db.prepare("DELETE FROM members WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to delete member" },
      { status: 500 }
    );
  }
}
