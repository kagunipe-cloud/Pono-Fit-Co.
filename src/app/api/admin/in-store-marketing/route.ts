import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAdminMemberId } from "@/lib/admin";
import {
  loadActiveInStoreMarketingSlides,
  loadInStoreMarketingRotationAdmin,
  normalizeMarketingRotationPatch,
  saveMarketingRotation,
} from "@/lib/in-store-marketing";

export const dynamic = "force-dynamic";

/** GET — Admin: current rotation config + active preview list. */
export async function GET(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const rotation = loadInStoreMarketingRotationAdmin(db);
  const active = loadActiveInStoreMarketingSlides(db);
  db.close();

  return NextResponse.json({ rotation, active });
}

/** PATCH — Admin: replace rotation order and enabled flags. */
export async function PATCH(request: NextRequest) {
  const adminId = await getAdminMemberId(request);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slides = normalizeMarketingRotationPatch(body);
  if (!slides) {
    return NextResponse.json({ error: "Body must include slides: [{ id, enabled, ... }]" }, { status: 400 });
  }

  const db = getDb();
  saveMarketingRotation(db, slides);
  const rotation = loadInStoreMarketingRotationAdmin(db);
  const active = loadActiveInStoreMarketingSlides(db);
  db.close();

  return NextResponse.json({ ok: true, rotation, active });
}
