import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";
import { ensureCartTables } from "../../../../lib/cart";
import { getMemberIdFromSession } from "../../../../lib/session";
import { getTrainerMemberId } from "../../../../lib/admin";
import { ensureRecurringClassesTables } from "../../../../lib/recurring-classes";
import { isOpenGroupSessionKind } from "../../../../lib/open-group-pt";
import {
  ensureRetailProductsTable,
  normalizeRetailSku,
  getMemberRetailSelfCheckoutEnabled,
  getMemberRetailAllowPurchaseWhenOutOfStock,
  getRetailInCartQty,
  getRetailLineMeta,
} from "../../../../lib/retail-products";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const member_id = (body.member_id ?? "").trim();
    const product_type = (body.product_type ?? "").trim();
    const product_id_raw = body.product_id;
    const product_id =
      product_id_raw === undefined || product_id_raw === null || String(product_id_raw).trim() === ""
        ? NaN
        : parseInt(String(product_id_raw), 10);
    const quantity = Math.max(1, parseInt(String(body.quantity), 10) || 1);

    const sessionMemberId = await getMemberIdFromSession();
    const isStaff = !!(await getTrainerMemberId(request));
    if (sessionMemberId !== member_id && !isStaff) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!member_id || !product_type) {
      return NextResponse.json({ error: "member_id and product_type required" }, { status: 400 });
    }
    if (product_type !== "retail" && Number.isNaN(product_id)) {
      return NextResponse.json({ error: "product_id required" }, { status: 400 });
    }
    if (
      !["membership_plan", "pt_session", "class", "class_pack", "class_occurrence", "pt_pack", "retail"].includes(
        product_type
      )
    ) {
      return NextResponse.json(
        {
          error:
            "product_type must be membership_plan, pt_session, class, class_pack, class_occurrence, pt_pack, or retail",
        },
        { status: 400 }
      );
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

    let resolvedProductId = product_id;
    if (product_type === "retail") {
      ensureRetailProductsTable(db);
      const sku = normalizeRetailSku(body.sku);
      if (sku) {
        const row = db
          .prepare(
            `SELECT p.id FROM retail_products p
             LEFT JOIN retail_product_groups g ON g.id = p.group_id
             WHERE p.sku = ? AND p.active = 1 AND (p.group_id IS NULL OR g.active = 1)`
          )
          .get(sku) as { id: number } | undefined;
        if (!row) {
          db.close();
          return NextResponse.json({ error: "Unknown SKU" }, { status: 404 });
        }
        resolvedProductId = row.id;
      } else if (Number.isNaN(product_id)) {
        db.close();
        return NextResponse.json({ error: "retail requires product_id or sku" }, { status: 400 });
      } else {
        const row = db
          .prepare(
            `SELECT p.id FROM retail_products p
             LEFT JOIN retail_product_groups g ON g.id = p.group_id
             WHERE p.id = ? AND p.active = 1 AND (p.group_id IS NULL OR g.active = 1)`
          )
          .get(product_id) as { id: number } | undefined;
        if (!row) {
          db.close();
          return NextResponse.json({ error: "Retail product not found or inactive" }, { status: 404 });
        }
        resolvedProductId = row.id;
      }

      if (!isStaff && sessionMemberId === member_id && !getMemberRetailSelfCheckoutEnabled(db)) {
        db.close();
        return NextResponse.json(
          {
            error:
              "Member self-checkout for the Pro Shop is not turned on yet. A staff member can add items at the front desk.",
          },
          { status: 403 }
        );
      }
    }

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

    if (product_type === "retail") {
      ensureRetailProductsTable(db);
      const already = getRetailInCartQty(db, cart.id, resolvedProductId);
      const meta = getRetailLineMeta(db, resolvedProductId);
      if (!meta) {
        db.close();
        return NextResponse.json({ error: "Retail product not found or inactive" }, { status: 404 });
      }
      const allowOosMember =
        !isStaff &&
        sessionMemberId === member_id &&
        getMemberRetailSelfCheckoutEnabled(db) &&
        getMemberRetailAllowPurchaseWhenOutOfStock(db);
      if (!allowOosMember) {
        const have = Math.max(0, Math.floor(Number(meta.stock_quantity) || 0));
        if (have < already + quantity) {
          db.close();
          return NextResponse.json(
            {
              error: `Not enough stock for ${meta.shelf_name} (${have} on hand; ${already} already in this cart).`,
            },
            { status: 409 }
          );
        }
      }
    }

    db.prepare(
      "INSERT INTO cart_items (cart_id, product_type, product_id, quantity, slot_json, gift_recipient_email) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(cart.id, product_type, resolvedProductId, quantity, slot_json, gift_recipient_email);
    const row = db.prepare("SELECT * FROM cart_items WHERE cart_id = ? ORDER BY id DESC LIMIT 1").get(cart.id);
    db.close();
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add to cart" }, { status: 500 });
  }
}
