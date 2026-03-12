import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensureTrainersTable } from "../../../../../lib/trainers";
import { ensureTrainerClientsTable } from "../../../../../lib/trainer-clients";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { getAdminMemberId } from "../../../../../lib/admin";

export const dynamic = "force-dynamic";

/** GET — fetch trainer details for editing (member + trainer row). Admin only. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await getAdminMemberId(_request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const memberId = (await params).id?.trim();
    if (!memberId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureTrainersTable(db);
    const member = db.prepare(
      "SELECT member_id, first_name, last_name, email, phone, role FROM members WHERE member_id = ?"
    ).get(memberId) as { member_id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; role: string | null } | undefined;
    const trainer = db.prepare("SELECT * FROM trainers WHERE member_id = ?").get(memberId) as {
      member_id: string;
      waiver_agreed_at: string | null;
      form_1099_received_at: string | null;
      form_i9_received_at: string | null;
      exempt_from_tax_forms: number;
    } | undefined;
    db.close();

    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (!trainer) return NextResponse.json({ error: "Not in trainers table (admin trainers cannot be edited here)" }, { status: 404 });

    return NextResponse.json({
      member_id: member.member_id,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      phone: member.phone,
      role: member.role,
      waiver_agreed_at: trainer.waiver_agreed_at ?? "",
      form_1099_received_at: trainer.form_1099_received_at ?? "",
      form_i9_received_at: trainer.form_i9_received_at ?? "",
      exempt_from_tax_forms: trainer.exempt_from_tax_forms,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch trainer" }, { status: 500 });
  }
}

/** PATCH — update trainer (doc dates). Admin only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const memberId = (await params).id?.trim();
    if (!memberId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const waiverAgreedAt = (body.waiver_agreed_at ?? "").trim() || null;
    const form1099At = (body.form_1099_received_at ?? "").trim() || null;
    const formI9At = (body.form_i9_received_at ?? "").trim() || null;
    const exemptFromBody = body.exempt_from_tax_forms === 1 || body.exempt_from_tax_forms === true;

    const db = getDb();
    ensureTrainersTable(db);
    const existing = db.prepare("SELECT 1 FROM trainers WHERE member_id = ?").get(memberId);
    if (!existing) {
      db.close();
      return NextResponse.json({ error: "Trainer not found" }, { status: 404 });
    }
    const member = db.prepare("SELECT role FROM members WHERE member_id = ?").get(memberId) as { role: string | null } | undefined;
    const isAdmin = member?.role === "Admin";
    const exempt = isAdmin || exemptFromBody ? 1 : 0;
    db.prepare(
      `UPDATE trainers SET waiver_agreed_at = ?, form_1099_received_at = ?, form_i9_received_at = ?, exempt_from_tax_forms = ?, updated_at = datetime('now') WHERE member_id = ?`
    ).run(exempt ? null : waiverAgreedAt, exempt ? null : form1099At, exempt ? null : formI9At, exempt, memberId);
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update trainer" }, { status: 500 });
  }
}

/** DELETE — remove trainer. Deletes availability blocks, client links, and bookings. Admin only. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminId = await getAdminMemberId(_request);
    if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const memberId = (await params).id?.trim();
    if (!memberId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = getDb();
    ensureTrainersTable(db);
    ensureTrainerClientsTable(db);
    ensurePTSlotTables(db);

    const member = db.prepare("SELECT role FROM members WHERE member_id = ?").get(memberId) as { role: string | null } | undefined;
    if (member?.role === "Admin") {
      db.close();
      return NextResponse.json({ error: "Cannot remove admin as trainer" }, { status: 400 });
    }
    const trainerRow = db.prepare("SELECT 1 FROM trainers WHERE member_id = ?").get(memberId);
    if (!trainerRow) {
      db.close();
      return NextResponse.json({ error: "Trainer not found" }, { status: 404 });
    }

    const blockIds = db.prepare("SELECT id FROM trainer_availability WHERE trainer_member_id = ?").all(memberId) as { id: number }[];
    for (const b of blockIds) {
      db.prepare("DELETE FROM pt_block_bookings WHERE trainer_availability_id = ?").run(b.id);
    }
    db.prepare("DELETE FROM trainer_availability WHERE trainer_member_id = ?").run(memberId);
    db.prepare("DELETE FROM trainer_clients WHERE trainer_member_id = ?").run(memberId);
    db.prepare("DELETE FROM trainers WHERE member_id = ?").run(memberId);
    db.prepare("UPDATE members SET role = ? WHERE member_id = ? AND role = ?").run("Member", memberId, "Trainer");
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete trainer" }, { status: 500 });
  }
}
