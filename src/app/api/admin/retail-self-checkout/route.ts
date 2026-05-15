import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  getMemberRetailAllowPurchaseWhenOutOfStock,
  getMemberRetailSelfCheckoutEnabled,
  setMemberRetailAllowPurchaseWhenOutOfStock,
  setMemberRetailSelfCheckoutEnabled,
} from "@/lib/retail-products";

export const dynamic = "force-dynamic";

function parseBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

/**
 * PATCH — Pro Shop settings (admin).
 * Body (at least one): { member_self_checkout_enabled?: boolean, member_allow_purchase_when_out_of_stock?: boolean }
 */
export async function PATCH(request: NextRequest) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const hasCheckout = body.member_self_checkout_enabled !== undefined;
  const hasOos = body.member_allow_purchase_when_out_of_stock !== undefined;
  if (!hasCheckout && !hasOos) {
    return NextResponse.json(
      { error: "member_self_checkout_enabled and/or member_allow_purchase_when_out_of_stock required" },
      { status: 400 }
    );
  }
  const db = getDb();
  if (hasCheckout) {
    setMemberRetailSelfCheckoutEnabled(db, parseBool(body.member_self_checkout_enabled));
  }
  if (hasOos) {
    setMemberRetailAllowPurchaseWhenOutOfStock(db, parseBool(body.member_allow_purchase_when_out_of_stock));
  }
  const out = {
    member_self_checkout_enabled: getMemberRetailSelfCheckoutEnabled(db),
    member_allow_purchase_when_out_of_stock: getMemberRetailAllowPurchaseWhenOutOfStock(db),
  };
  db.close();
  return NextResponse.json(out);
}
