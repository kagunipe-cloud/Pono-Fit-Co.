import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadActiveInStoreMarketingSlides } from "@/lib/in-store-marketing";

export const dynamic = "force-dynamic";

/** GET — Public slideshow for `/ismtv` (no login). */
export async function GET() {
  const db = getDb();
  const slides = loadActiveInStoreMarketingSlides(db);
  db.close();
  return NextResponse.json({ slides });
}
