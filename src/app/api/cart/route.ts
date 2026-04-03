import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/db";
import { ensureCartTables } from "../../../lib/cart";
import { getMemberIdFromSession } from "../../../lib/session";
import { getTrainerMemberId } from "../../../lib/admin";
import { ensureDiscountsTable } from "../../../lib/discounts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const member_id = request.nextUrl.searchParams.get("member_id");
  if (!member_id) {
    return NextResponse.json({ error: "member_id required" }, { status: 400 });
  }
  const sessionMemberId = await getMemberIdFromSession();
  const isStaff = !!(await getTrainerMemberId(request));
  if (sessionMemberId !== member_id && !isStaff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const db = getDb();
    ensureCartTables(db);

    let cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number; member_id: string; promo_code?: string | null } | undefined;
    if (!cart) {
      db.prepare("INSERT INTO cart (member_id) VALUES (?)").run(member_id);
      cart = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id) as { id: number; member_id: string; promo_code?: string | null };
    }

    const rawItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cart.id) as {
      id: number;
      product_type: string;
      product_id: number;
      quantity: number;
      slot_json?: string | null;
      gift_recipient_email?: string | null;
    }[];
    const items: {
      id: number;
      product_type: string;
      product_id: number;
      quantity: number;
      name: string;
      price: string;
      gift_recipient_email?: string | null;
      slot?: { date: string; start_time: string; duration_minutes: number };
    }[] = [];

    for (const it of rawItems) {
      let name = "—";
      let price = "—";
      if (it.product_type === "membership_plan") {
        const row = db.prepare("SELECT plan_name, price FROM membership_plans WHERE id = ?").get(it.product_id) as { plan_name: string; price: string } | undefined;
        if (row) {
          name = row.plan_name ?? "—";
          price = row.price ?? "—";
        }
      } else if (it.product_type === "pt_session") {
        const row = db.prepare("SELECT session_name, price FROM pt_sessions WHERE id = ?").get(it.product_id) as { session_name: string; price: string } | undefined;
        if (row) {
          name = row.session_name ?? "—";
          price = row.price ?? "—";
        }
      } else if (it.product_type === "class") {
        const row = db.prepare("SELECT class_name, price FROM classes WHERE id = ?").get(it.product_id) as { class_name: string; price: string } | undefined;
        if (row) {
          name = row.class_name ?? "—";
          price = row.price ?? "—";
        }
      }
      let slot: { date: string; start_time: string; duration_minutes: number } | undefined;
      if (it.slot_json) {
        try {
          const parsed = JSON.parse(it.slot_json as string);
          if (parsed?.date && parsed?.start_time != null && typeof parsed.duration_minutes === "number") {
            slot = { date: String(parsed.date), start_time: String(parsed.start_time), duration_minutes: Number(parsed.duration_minutes) };
          }
        } catch {
          /* ignore */
        }
      }
      items.push({ ...it, name, price, ...(slot && { slot }) });
    }

    db.close();
    return NextResponse.json({ cart, items });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}

/** PATCH — Apply or remove promo code. Body: { member_id, promo_code } (promo_code empty to clear). */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const member_id = (body.member_id ?? "").trim();
    const promo_code = (body.promo_code ?? "").trim().toUpperCase() || null;

    if (!member_id) return NextResponse.json({ error: "member_id required" }, { status: 400 });

    const sessionMemberId = await getMemberIdFromSession();
    const isStaff = !!(await getTrainerMemberId(request));
    if (sessionMemberId !== member_id && !isStaff) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const db = getDb();
    ensureCartTables(db);
    if (promo_code) {
      ensureDiscountsTable(db);
      const discount = db.prepare("SELECT id FROM discounts WHERE UPPER(TRIM(code)) = ?").get(promo_code);
      if (!discount) {
        db.close();
        return NextResponse.json({ error: "Invalid or expired promo code" }, { status: 400 });
      }
    }

    let cart = db.prepare("SELECT id FROM cart WHERE member_id = ?").get(member_id) as { id: number } | undefined;
    if (!cart) {
      db.prepare("INSERT INTO cart (member_id) VALUES (?)").run(member_id);
      cart = db.prepare("SELECT id FROM cart WHERE member_id = ?").get(member_id) as { id: number };
    }
    db.prepare("UPDATE cart SET promo_code = ? WHERE member_id = ?").run(promo_code, member_id);
    const updated = db.prepare("SELECT * FROM cart WHERE member_id = ?").get(member_id);
    db.close();
    return NextResponse.json({ ok: true, cart: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update cart" }, { status: 500 });
  }
}
