import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import { getMemberRetailSelfCheckoutEnabled, setMemberRetailSelfCheckoutEnabled } from "@/lib/retail-products";

export const dynamic = "force-dynamic";

/** PATCH { member_self_checkout_enabled: boolean } — let members use /member/retail without staff. */
export async function PATCH(request: NextRequest) {
  if (!(await getAdminMemberId(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.member_self_checkout_enabled === undefined) {
    return NextResponse.json({ error: "member_self_checkout_enabled required" }, { status: 400 });
  }
  const v = body.member_self_checkout_enabled;
  const enabled = v === true || v === 1 || v === "1" || v === "true";
  const db = getDb();
  setMemberRetailSelfCheckoutEnabled(db, enabled);
  const out = getMemberRetailSelfCheckoutEnabled(db);
  db.close();
  return NextResponse.json({ member_self_checkout_enabled: out });
}
