import { NextRequest, NextResponse } from "next/server";
import { getDb, getAppTimezone } from "../../../../../lib/db";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { getAdminMemberId } from "../../../../../lib/admin";
import {
  sendMemberEmail,
  sendMemberBookingConfirmationEmail,
  getTrainerDisplayNameFromMemberId,
} from "../../../../../lib/email";

export const dynamic = "force-dynamic";

/** GET a single PT open booking. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const row = db.prepare("SELECT * FROM pt_open_bookings WHERE id = ?").get(numericId);
    db.close();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch booking" }, { status: 500 });
  }
}

/** PATCH: update occurrence_date, start_time, member_id, guest_name, trainer_member_id. Admin only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = await request.json();
    const db = getDb();
    ensurePTSlotTables(db);
    const existing = db.prepare("SELECT * FROM pt_open_bookings WHERE id = ?").get(numericId) as Record<string, unknown> | undefined;
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const occurrence_date = body.occurrence_date !== undefined ? String(body.occurrence_date).trim() : existing.occurrence_date;
    const start_time = body.start_time !== undefined ? String(body.start_time).trim() : existing.start_time;
    const guest_name = body.guest_name !== undefined ? (String(body.guest_name).trim() || null) : existing.guest_name;
    const member_id = body.member_id !== undefined ? String(body.member_id).trim() : existing.member_id;
    const effectiveMemberId = guest_name ? "" : (member_id ?? "");
    const effectiveGuestName = guest_name ?? (effectiveMemberId ? null : existing.guest_name);
    const trainer_member_id = body.trainer_member_id !== undefined ? (String(body.trainer_member_id).trim() || null) : (existing.trainer_member_id as string | null) ?? null;

    const prevTrainerId = (existing.trainer_member_id as string | null) ?? null;
    const isNewAssignment = trainer_member_id && trainer_member_id !== prevTrainerId;

    db.prepare(
      "UPDATE pt_open_bookings SET occurrence_date = ?, start_time = ?, member_id = ?, guest_name = ?, trainer_member_id = ? WHERE id = ?"
    ).run(occurrence_date, start_time, effectiveMemberId, effectiveGuestName, trainer_member_id, numericId);
    const row = db.prepare("SELECT * FROM pt_open_bookings WHERE id = ?").get(numericId);

    if (isNewAssignment && trainer_member_id) {
      const memberRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(effectiveMemberId) as {
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      } | undefined;
      const trainerRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(trainer_member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
      const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || "A client" : "A client";
      const trainerEmail = trainerRow?.email?.trim();
      if (trainerEmail) {
        const subject = `PT session assigned: ${memberName} — ${occurrence_date} at ${start_time}`;
        const text = `You've been assigned a PT session with ${memberName} on ${occurrence_date} at ${start_time}.`;
        sendMemberEmail(trainerEmail, subject, text).catch(() => {});
      }
      const memberEmail = memberRow?.email?.trim();
      if (memberEmail && effectiveMemberId) {
        const ptSessionId = existing.pt_session_id as number;
        const sess = db
          .prepare("SELECT session_name, duration_minutes FROM pt_sessions WHERE id = ?")
          .get(ptSessionId) as { session_name: string | null; duration_minutes: number } | undefined;
        const dur = (existing.duration_minutes as number) ?? sess?.duration_minutes ?? 60;
        const sessionTitle = sess?.session_name?.trim() || `${dur} min PT`;
        const tz = getAppTimezone(db);
        const trainerDisplay = getTrainerDisplayNameFromMemberId(db, trainer_member_id);
        sendMemberBookingConfirmationEmail({
          to: memberEmail,
          memberFirstName: memberRow?.first_name,
          kind: "pt",
          sessionTitle,
          dateYmd: String(occurrence_date),
          timeRaw: String(start_time),
          trainerDisplayName: trainerDisplay,
          timeZone: tz,
          variant: "trainer_assigned",
        }).catch(() => {});
      }
    }

    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update booking" }, { status: 500 });
  }
}

/** DELETE. If payment_type was 'credit', restore 1 credit. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);
    const row = db.prepare("SELECT member_id, duration_minutes, payment_type FROM pt_open_bookings WHERE id = ?").get(numericId) as
      | { member_id: string; duration_minutes: number; payment_type: string }
      | undefined;
    if (!row) {
      db.close();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (row.payment_type === "credit" && row.member_id) {
      db.prepare(
        "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, 1, ?, 'admin_cancel_open_booking', ?)"
      ).run(row.member_id, row.duration_minutes, "Credit restored (booking removed)", String(numericId));
    }
    db.prepare("DELETE FROM pt_open_bookings WHERE id = ?").run(numericId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete booking" }, { status: 500 });
  }
}
