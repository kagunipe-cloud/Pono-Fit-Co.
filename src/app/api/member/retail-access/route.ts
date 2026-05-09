import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMemberIdFromSession } from "@/lib/session";
import { getMemberRetailSelfCheckoutEnabled } from "@/lib/retail-products";

export const dynamic = "force-dynamic";

/** GET — whether member-facing Pro Shop self-checkout is enabled (member session required). */
export async function GET() {
  const memberId = await getMemberIdFromSession();
  if (!memberId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  const db = getDb();
  const member_self_checkout_enabled = getMemberRetailSelfCheckoutEnabled(db);
  db.close();
  return NextResponse.json({ member_self_checkout_enabled });
}
