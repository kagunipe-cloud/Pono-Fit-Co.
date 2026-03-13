import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureMembersPhoneColumn } from "../../../../lib/db";
import { ensureTrainersTable } from "../../../../lib/trainers";
import { getAdminMemberId } from "../../../../lib/admin";
import { grantAccess as kisiGrantAccess, ensureKisiUser } from "../../../../lib/kisi";
import { randomUUID } from "crypto";

/** 10 years from now for trainer door access. */
function trainerAccessExpiry(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 10);
  return d;
}

export const dynamic = "force-dynamic";

/**
 * POST — Create a trainer. Body:
 * - existing_member_id (optional): use this member and add to trainers.
 * - OR first_name, last_name, email, phone (for new member; role set to Trainer).
 * - waiver_agreed_at (optional date string)
 * - form_1099_received_at (optional date string)
 * - form_i9_received_at (optional date string)
 * If existing member has role Admin, exempt_from_tax_forms is set and 1099/I-9 are not required.
 */
export async function POST(request: NextRequest) {
  let db: ReturnType<typeof getDb> | null = null;
  try {
    const adminId = await getAdminMemberId(request);
    if (!adminId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const existingMemberId = (body.existing_member_id ?? "").trim() || null;
    const firstName = (body.first_name ?? "").trim() || null;
    const lastName = (body.last_name ?? "").trim() || null;
    const email = (body.email ?? "").trim().toLowerCase() || null;
    const phone = (body.phone ?? "").trim() || null;
    const waiverAgreedAt = (body.waiver_agreed_at ?? "").trim() || null;
    const form1099At = (body.form_1099_received_at ?? "").trim() || null;
    const formI9At = (body.form_i9_received_at ?? "").trim() || null;

    db = getDb();
    ensureMembersPhoneColumn(db);
    ensureTrainersTable(db);

    let memberId: string;
    let isAdmin = false;

    if (existingMemberId) {
      const member = db.prepare("SELECT member_id, role FROM members WHERE member_id = ?").get(existingMemberId) as { member_id: string; role: string | null } | undefined;
      if (!member) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
      const existingTrainer = db.prepare("SELECT 1 FROM trainers WHERE member_id = ?").get(existingMemberId);
      if (existingTrainer) {
        return NextResponse.json({ error: "Member is already a trainer" }, { status: 400 });
      }
      memberId = member.member_id;
      isAdmin = member.role === "Admin";
      if (member.role !== "Admin") {
        db.prepare("UPDATE members SET role = ? WHERE member_id = ?").run("Trainer", memberId);
      }
    } else {
      if (!email) {
        return NextResponse.json({ error: "Email required for new member" }, { status: 400 });
      }
      const existing = db.prepare("SELECT member_id FROM members WHERE LOWER(TRIM(email)) = ?").get(email) as { member_id: string } | undefined;
      if (existing) {
        return NextResponse.json({ error: "A member with this email already exists; use existing member instead" }, { status: 400 });
      }
      memberId = randomUUID().slice(0, 8);
      db.prepare(
        "INSERT INTO members (member_id, first_name, last_name, email, phone, role) VALUES (?, ?, ?, ?, ?, 'Trainer')"
      ).run(memberId, firstName ?? "", lastName ?? "", email, phone);
    }

    const exempt = isAdmin ? 1 : 0;
    db.prepare(
      `INSERT INTO trainers (member_id, waiver_agreed_at, form_1099_received_at, form_i9_received_at, exempt_from_tax_forms)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      memberId,
      waiverAgreedAt,
      exempt ? null : form1099At,
      exempt ? null : formI9At,
      exempt
    );

    const memberRow = db.prepare("SELECT email, kisi_id, first_name, last_name FROM members WHERE member_id = ?").get(memberId) as {
      email: string | null;
      kisi_id: string | null;
      first_name: string | null;
      last_name: string | null;
    } | undefined;
    const memberEmail = memberRow?.email?.trim();
    if (memberEmail) {
      try {
        let kisiId = memberRow?.kisi_id?.trim() || null;
        if (!kisiId) {
          const name = [memberRow?.first_name, memberRow?.last_name].filter(Boolean).join(" ") || undefined;
          kisiId = await ensureKisiUser(memberEmail, name);
          db.prepare("UPDATE members SET kisi_id = ? WHERE member_id = ?").run(kisiId, memberId);
        }
        if (kisiId) {
          await kisiGrantAccess(kisiId, trainerAccessExpiry());
        }
      } catch (e) {
        console.error("[POST /api/admin/trainers] Kisi door access grant failed:", e);
      }
    }

    const row = db.prepare("SELECT * FROM trainers WHERE member_id = ?").get(memberId);
    return NextResponse.json(row);
  } catch (err) {
    console.error("[POST /api/admin/trainers]", err);
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
    return NextResponse.json({ error: "Failed to create trainer", detail: message || "Unknown error" }, { status: 500 });
  } finally {
    if (db) db.close();
  }
}
