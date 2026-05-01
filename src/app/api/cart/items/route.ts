import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureCartTables } from "../../../../lib/cart";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getTrainerMemberId } from "../../../../lib/admin";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";
import { isOpenGroupSessionKind } from "../../../../lib/open-group-pt";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const product_type = (body.product_type ?? "").trim();
    const product_id = parseInt(String(body.product_id), 10);
    const quantity = Math.max(1, parseInt(String(body.quantity), 10) || 1);

    const sessionMemberId = await getMemberIdFromSession();
    const isStaff = !!(await getTrainerMemberId(request));
    if (sessionMemberId !== member_id && !isStaff) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!member_id || !product_type || Number.isNaN(product_id)) {
      return NextResponse.json({ error: "member_id, product_type, product_id required" }, { status: 400 });
    }
    if (!["membership_plan", "pt_session", "class", "class_pack", "class_occurrence", "pt_pack"].includes(product_type)) {
      return NextResponse.json({ error: "product_type must be membership_plan, pt_session, class, class_pack, class_occurrence, or pt_pack" }, { status: 400 });
    }

    const slot = body.slot;
    const slot_json =
      product_type === "pt_session" && slot && typeof slot === "object" && slot.date && slot.start_time && slot.duration_minutes
        ? JSON.stringify({
            date: String(slot.date),
            start_time: String(slot.start_time),
            duration_minutes: Number(slot.duration_minutes),
            ...(slot.trainer_member_id && typeof slot.trainer_member_id === "string" && slot.trainer_member_id.trim()
              ? { trainer_member_id: String(slot.trainer_member_id).trim() }
              : {}),
          })
        : null;

    let gift_recipient_email: string | null = null;
    if (product_type === "membership_plan" && body.gift_recipient_email != null && String(body.gift_recipient_email).trim() !== "") {
      const g = String(body.gift_recipient_email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g)) {
        return NextResponse.json({ error: "Invalid gift_recipient_email" }, { status: 400 });
      }
      gift_recipient_email = g;
    }

    const db = getDb();
    ensureCartTables(db);

    if (product_type === "class_occurrence") {
      ensureRecurringClassesTables(db);
      const occMeta = db
        .prepare(
          `SELECT COALESCE(r.session_kind, 'standard') AS session_kind
           FROM class_occurrences o
           LEFT JOIN recurring_classes r ON r.id = o.recurring_class_id
           WHERE o.id = ?`
        )
        .get(product_id) as { session_kind: string } | undefined;
      if (!occMeta) {
        db.close();
        return NextResponse.json({ error: "Class occurrence not found" }, { status: 404 });
      }
      if (isOpenGroupSessionKind(occMeta.session_kind)) {
        db.close();
        return NextResponse.json(
          {
            error:
              "Open Group PT is reserved on the schedule (flat fee at the gym). Use Schedule → Book to start or join a group.",
          },
          { status: 400 }
        );
      }
    }

    let cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number } | undefined;
    if (!cart) {
      db.prepare("INSERT INTO cart (member_id) VALUES (?)").run(member_id);
      cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number };
    }

    db.prepare(
      "INSERT INTO cart_items (cart_id, product_type, product_id, quantity, slot_json, gift_recipient_email) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(cart.id, product_type, product_id, quantity, slot_json, gift_recipient_email);
    const row = db.prepare("SELECT * FROM cart_items WHERE cart_id = ? ORDER BY id DESC LIMIT 1").get(cart.id);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add to cart" }, { status: 500 });
  }
}
