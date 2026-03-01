import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../../lib/db";
import { getTrainerMemberId, getAdminMemberId } from "../../../../../../lib/admin";
import { ensurePTSlotTables } from "../../../../../../lib/pt-slots";
import { ensureTrainerClientsTable } from "../../../../../../lib/trainer-clients";

export const dynamic = "force-dynamic";

/** GET — PT bookings for this client (block, open, slot). Caller must be the client's trainer or admin. Returns combined list sorted by date/time. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const trainerId = await getTrainerMemberId(_request);
  const adminId = await getAdminMemberId(_request);
  if (!trainerId && !adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientMemberId = (await params).id?.trim();
  if (!clientMemberId) {
    return NextResponse.json({ error: "Client id required" }, { status: 400 });
  }

  const db = getDb();
  ensureTrainerClientsTable(db);
  const isAdmin = !!adminId;
  if (!isAdmin) {
    const link = db.prepare("SELECT 1 FROM trainer_clients WHERE trainer_member_id = ? AND client_member_id = ?").get(trainerId, clientMemberId);
    if (!link) {
      db.close();
      return NextResponse.json({ error: "You can only view your own clients" }, { status: 403 });
    }
  }

  ensurePTSlotTables(db);

  const blockBookings = db.prepare(`
    SELECT b.id, b.occurrence_date, b.start_time, b.session_duration_minutes, b.payment_type, b.created_at, a.trainer
    FROM pt_block_bookings b
    JOIN trainer_availability a ON a.id = b.trainer_availability_id
    WHERE b.member_id = ?
    ORDER BY b.occurrence_date ASC, b.start_time ASC
  `).all(clientMemberId) as { id: number; occurrence_date: string; start_time: string; session_duration_minutes: number; payment_type: string; created_at: string; trainer: string }[];

  let openBookings: { id: number; occurrence_date: string; start_time: string; duration_minutes: number; session_name: string | null; trainer: string | null }[] = [];
  try {
    openBookings = db.prepare(`
      SELECT ob.id, ob.occurrence_date, ob.start_time, ob.duration_minutes, p.session_name, p.trainer
      FROM pt_open_bookings ob
      LEFT JOIN pt_sessions p ON p.id = ob.pt_session_id
      WHERE ob.member_id = ?
      ORDER BY ob.occurrence_date ASC, ob.start_time ASC
    `).all(clientMemberId) as { id: number; occurrence_date: string; start_time: string; duration_minutes: number; session_name: string | null; trainer: string | null }[];
  } catch {
    /* table may not exist */
  }

  const slotBookings = db.prepare(`
    SELECT b.id, p.date_time, p.session_name, p.trainer
    FROM pt_slot_bookings b
    LEFT JOIN pt_sessions p ON p.id = b.pt_session_id
    WHERE b.member_id = ?
    ORDER BY p.date_time ASC
  `).all(clientMemberId) as { id: number; date_time: string | null; session_name: string | null; trainer: string | null }[];

  type BookingItem = { type: "block" | "open" | "slot"; sortKey: string; label: string; trainer?: string | null };
  const items: BookingItem[] = [];

  for (const b of blockBookings) {
    items.push({
      type: "block",
      sortKey: `${b.occurrence_date}T${b.start_time}`,
      label: `${b.occurrence_date} ${b.start_time} — ${b.session_duration_minutes} min`,
      trainer: b.trainer,
    });
  }
  for (const b of openBookings) {
    items.push({
      type: "open",
      sortKey: `${b.occurrence_date}T${b.start_time}`,
      label: `${b.occurrence_date} ${b.start_time} — ${b.duration_minutes} min${b.session_name ? ` · ${b.session_name}` : ""}`,
      trainer: b.trainer ?? undefined,
    });
  }
  for (const b of slotBookings) {
    const dt = b.date_time ?? "";
    items.push({
      type: "slot",
      sortKey: dt,
      label: dt ? `${dt} · ${b.session_name ?? "PT"}` : String(b.session_name ?? "PT slot"),
      trainer: b.trainer ?? undefined,
    });
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  db.close();
  return NextResponse.json({ bookings: items });
}
