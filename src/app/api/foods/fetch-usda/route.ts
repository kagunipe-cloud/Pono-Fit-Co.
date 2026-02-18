import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";

/**
 * GET ?fdcId= — fetch one food by FDC ID from USDA (full details including all nutrients).
 * Use this when a search result doesn't include foodNutrients, then POST to save-from-usda.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fdcId = searchParams.get("fdcId");
    const apiKey = process.env.FDC_API_KEY ?? "DEMO_KEY";

    if (!fdcId || !/^\d+$/.test(fdcId)) {
      return NextResponse.json({ error: "Valid fdcId query is required" }, { status: 400 });
    }

    const url = `${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message ?? data.error ?? "USDA fetch failed" },
        { status: res.status >= 400 ? res.status : 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch from USDA" }, { status: 500 });
  }
}
