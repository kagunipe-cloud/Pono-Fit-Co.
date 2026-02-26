import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone, expiryDateSortableSql } from "../../../lib/db";
import { formatInAppTz, todayInAppTz, parseAppDateToYMD, ymdGte } from "../../../lib/app-timezone";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export type MemberType = "Monthly" | "Day pass" | "Week pass" | "Class client" | "PT client";

function getTodayYMD(tz: string): [number, number, number] {
  const s = todayInAppTz(tz);
  const [y, m, d] = s.split("-").map(Number);
  return [y, m!, d!];
}

function getMemberTypesMap(db: ReturnType<typeof getDb>): Map<string, MemberType[]> {
  const map = new Map<string, MemberType[]>();
  const add = (memberId: string, type: MemberType) => {
    const list = map.get(memberId) ?? [];
    if (!list.includes(type)) list.push(type);
    map.set(memberId, list);
  };
  try {
    const monthly = db.prepare(`
      SELECT DISTINCT s.member_id FROM subscriptions s
      JOIN membership_plans p ON p.product_id = s.product_id
      WHERE s.status = 'Active' AND p.unit = 'Month'
    `).all() as { member_id: string }[];
    monthly.forEach((r) => add(r.member_id, "Monthly"));
  } catch { /* ignore */ }
  try {
    const dayPass = db.prepare(`
      SELECT DISTINCT s.member_id FROM subscriptions s
      JOIN membership_plans p ON p.product_id = s.product_id
      WHERE s.status = 'Active' AND p.unit = 'Day'
    `).all() as { member_id: string }[];
    dayPass.forEach((r) => add(r.member_id, "Day pass"));
  } catch { /* ignore */ }
  try {
    const weekPass = db.prepare(`
      SELECT DISTINCT s.member_id FROM subscriptions s
      JOIN membership_plans p ON p.product_id = s.product_id
      WHERE s.status = 'Active' AND p.unit = 'Week'
    `).all() as { member_id: string }[];
    weekPass.forEach((r) => add(r.member_id, "Week pass"));
  } catch { /* ignore */ }
  try {
    const classClients = db.prepare("SELECT DISTINCT member_id FROM class_bookings").all() as { member_id: string }[];
    classClients.forEach((r) => add(r.member_id, "Class client"));
  } catch { /* ignore */ }
  try {
    const ledger = db.prepare("SELECT DISTINCT member_id FROM class_credit_ledger").all() as { member_id: string }[];
    ledger.forEach((r) => add(r.member_id, "Class client"));
  } catch { /* ignore */ }
  try {
    const ptBookings = db.prepare("SELECT DISTINCT member_id FROM pt_bookings").all() as { member_id: string }[];
    ptBookings.forEach((r) => add(r.member_id, "PT client"));
  } catch { /* ignore */ }
  try {
    const ptSlot = db.prepare("SELECT DISTINCT member_id FROM pt_slot_bookings").all() as { member_id: string }[];
    ptSlot.forEach((r) => add(r.member_id, "PT client"));
  } catch { /* ignore */ }
  try {
    const ptBlock = db.prepare("SELECT DISTINCT member_id FROM pt_block_bookings").all() as { member_id: string }[];
    ptBlock.forEach((r) => add(r.member_id, "PT client"));
  } catch { /* ignore */ }
  try {
    const ptLedger = db.prepare("SELECT DISTINCT member_id FROM pt_credit_ledger").all() as { member_id: string }[];
    ptLedger.forEach((r) => add(r.member_id, "PT client"));
  } catch { /* ignore */ }
  return map;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim();

  try {
    const db = getDb();
    const tz = getAppTimezone(db);
    const todayYMD = getTodayYMD(tz);
    const typesMap = getMemberTypesMap(db);

    let rows: Record<string, unknown>[];
    if (q) {
      const pattern = `%${q.replace(/%/g, "\\%")}%`;
      const stmt = db.prepare(`
        SELECT m.id, m.member_id, m.first_name, m.last_name, m.email, m.phone, m.kisi_id, m.kisi_group_id, m.join_date,
          COALESCE(m.exp_next_payment_date, (SELECT s.expiry_date FROM subscriptions s WHERE s.member_id = m.member_id AND s.status = 'Active' ORDER BY ${expiryDateSortableSql("s.expiry_date")} DESC LIMIT 1)) AS exp_next_payment_date,
          m.role, m.created_at
        FROM members m
        WHERE m.first_name LIKE ? OR m.last_name LIKE ? OR m.email LIKE ? OR m.role LIKE ? OR m.member_id LIKE ?
        ORDER BY m.last_name ASC, m.first_name ASC
      `);
      rows = stmt.all(pattern, pattern, pattern, pattern, pattern) as Record<string, unknown>[];
    } else {
      const stmt = db.prepare(`
        SELECT m.id, m.member_id, m.first_name, m.last_name, m.email, m.phone, m.kisi_id, m.kisi_group_id, m.join_date,
          COALESCE(m.exp_next_payment_date, (SELECT s.expiry_date FROM subscriptions s WHERE s.member_id = m.member_id AND s.status = 'Active' ORDER BY ${expiryDateSortableSql("s.expiry_date")} DESC LIMIT 1)) AS exp_next_payment_date,
          m.role, m.created_at
        FROM members m
        ORDER BY m.last_name ASC, m.first_name ASC
      `);
      rows = stmt.all() as Record<string, unknown>[];
    }

    const members = rows.map((m) => {
      const exp = m.exp_next_payment_date as string | null | undefined;
      const active = ymdGte(parseAppDateToYMD(exp), todayYMD);
      const types = typesMap.get(String(m.member_id)) ?? [];
      return { ...m, active, types };
    });

    db.close();
    return NextResponse.json(members);
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
    const emailRaw = (body.email ?? "").trim();
    if (!emailRaw) {
      return NextResponse.json(
        { error: "Email is required. It is used for login and Kisi door access." },
        { status: 400 }
      );
    }
    const email = emailRaw;
    const role = (body.role ?? "Member").trim() || "Member";
    const phone = typeof body.phone === "string" ? body.phone.trim() || null : null;

    const db = getDb();
    const tz = getAppTimezone(db);
    const member_id = randomUUID().slice(0, 8);
    const join_date = formatInAppTz(new Date(), { month: "numeric", day: "numeric", year: "numeric" }, tz);

    const stmt = db.prepare(`
      INSERT INTO members (member_id, first_name, last_name, email, phone, join_date, role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(member_id, first_name, last_name, email, phone, join_date, role);
    db.close();

    return NextResponse.json({
      id: result.lastInsertRowid,
      member_id,
      first_name,
      last_name,
      email,
      phone,
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
