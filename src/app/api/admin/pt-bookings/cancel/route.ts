import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { ensurePTSlotTables } from "../../../../../lib/pt-slots";
import { getAdminMemberId } from "../../../../../lib/admin";
import { sendStaffEmail, sendMemberEmail } from "../../../../../lib/email";

export const dynamic = "force-dynamic";

/** POST { type, id } | { type, ids: number[] } — Admin only. Cancels PT booking(s); trainer-specific/open credit bookings get credit restored. */
export async function POST(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const type = (body.type ?? "").trim();
    let ids: number[] = [];
    if (Array.isArray(body.ids)) {
      ids = body.ids.map((x: unknown) => parseInt(String(x), 10)).filter((n: number) => !Number.isNaN(n));
    } else {
      const single = parseInt(String(body.id), 10);
      if (!Number.isNaN(single)) ids = [single];
    }
    if (!["slot", "trainer_specific", "open"].includes(type) || ids.length === 0) {
      return NextResponse.json({ error: "type must be 'slot', 'trainer_specific', or 'open', and id or ids required" }, { status: 400 });
    }
    const db = getDb();
    ensurePTSlotTables(db);

    for (const id of ids) {
      if (type === "slot") {
        const row = db.prepare("SELECT id, pt_session_id, member_id FROM pt_slot_bookings WHERE id = ?").get(id) as { id: number; pt_session_id: number; member_id: string } | undefined;
        if (!row) continue;
        const session = db.prepare("SELECT duration_minutes, session_name, trainer FROM pt_sessions WHERE id = ?").get(row.pt_session_id) as { duration_minutes: number; session_name?: string | null; trainer?: string | null } | undefined;
        db.prepare("DELETE FROM pt_slot_bookings WHERE id = ?").run(id);
        if (session?.duration_minutes) {
          db.prepare(
            "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, 1, ?, 'admin_cancel_slot', ?)"
          ).run(row.member_id, session.duration_minutes, "Credit restored (admin cancelled booking)", String(id));
        }
        try {
          const memberRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(row.member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
          const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || row.member_id : row.member_id;
          const displaySessionName = session?.session_name || "PT session";
          sendStaffEmail(`PT booking cancelled (admin): ${memberName} → ${displaySessionName}`, `Admin cancelled a PT slot booking for ${memberName} (${displaySessionName}).`).catch(() => {});
          const trainerName = (session?.trainer ?? "").trim();
          if (trainerName) {
            const trainerRow = db.prepare(`SELECT m.email FROM trainers t JOIN members m ON m.member_id = t.member_id WHERE TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) = ?`).get(trainerName) as { email: string | null } | undefined;
            const trainerEmail = trainerRow?.email?.trim();
            if (trainerEmail) sendMemberEmail(trainerEmail, `PT booking cancelled for ${memberName}`, `An admin cancelled your PT booking with ${memberName} (${displaySessionName}).`).catch(() => {});
          }
        } catch {
          /* ignore */
        }
      } else if (type === "open") {
        const row = db.prepare("SELECT id, member_id, duration_minutes, payment_type FROM pt_open_bookings WHERE id = ?").get(id) as { id: number; member_id: string; duration_minutes: number; payment_type: string } | undefined;
        if (!row) continue;
        db.prepare("DELETE FROM pt_open_bookings WHERE id = ?").run(id);
        if (row.payment_type === "credit") {
          db.prepare(
            "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, 1, ?, 'admin_cancel_open', ?)"
          ).run(row.member_id, row.duration_minutes, "Credit restored (admin cancelled booking)", String(id));
        }
        try {
          const memberRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(row.member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
          const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || row.member_id : row.member_id;
          sendStaffEmail(`PT booking cancelled (admin): ${memberName} → open slot`, `An admin cancelled a PT open booking for ${memberName}.`).catch(() => {});
        } catch {
          /* ignore */
        }
      } else {
        let row = db.prepare("SELECT id, member_id, session_duration_minutes, payment_type FROM pt_trainer_specific_bookings WHERE id = ?").get(id) as { id: number; member_id: string; session_duration_minutes: number; payment_type: string } | undefined;
        if (!row) {
          const openRow = db.prepare("SELECT id, member_id, duration_minutes, payment_type FROM pt_open_bookings WHERE id = ?").get(id) as { id: number; member_id: string; duration_minutes: number; payment_type: string } | undefined;
          if (openRow) {
            db.prepare("DELETE FROM pt_open_bookings WHERE id = ?").run(id);
            if (openRow.payment_type === "credit") {
              db.prepare(
                "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, 1, ?, 'admin_cancel_open', ?)"
              ).run(openRow.member_id, openRow.duration_minutes, "Credit restored (admin cancelled booking)", String(id));
            }
            try {
              const memberRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(openRow.member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
              const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || openRow.member_id : openRow.member_id;
              sendStaffEmail(`PT booking cancelled (admin): ${memberName} → open slot`, `An admin cancelled a PT open booking for ${memberName}.`).catch(() => {});
            } catch {
              /* ignore */
            }
            continue;
          }
          continue;
        }
        db.prepare("DELETE FROM pt_trainer_specific_bookings WHERE id = ?").run(id);
        if (row.payment_type === "credit") {
          db.prepare(
            "INSERT INTO pt_credit_ledger (member_id, duration_minutes, amount, reason, reference_type, reference_id) VALUES (?, ?, 1, ?, 'admin_cancel_trainer_specific', ?)"
          ).run(row.member_id, row.session_duration_minutes, "Credit restored (admin cancelled booking)", String(id));
        }
        try {
          const memberRow = db.prepare("SELECT email, first_name, last_name FROM members WHERE member_id = ?").get(row.member_id) as { email: string | null; first_name: string | null; last_name: string | null } | undefined;
          const memberName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || row.member_id : row.member_id;
          sendStaffEmail(`PT booking cancelled (admin): ${memberName} → trainer-specific session`, `An admin cancelled a PT trainer-specific booking for ${memberName}.`).catch(() => {});
        } catch {
          /* ignore */
        }
      }
    }
    db.close();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to cancel PT booking" }, { status: 500 });
  }
}
