import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 300;

type CacheEntry = { data: unknown; ts: number };
const searchCache = new Map<string, CacheEntry>();

function pruneCache() {
  if (searchCache.size <= CACHE_MAX) return;
  const entries = [...searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = entries.slice(0, searchCache.size - CACHE_MAX);
  toRemove.forEach(([k]) => searchCache.delete(k));
}

/**
 * GET ?q= — proxy to USDA FoodData Central search. Uses FDC_API_KEY env (or DEMO_KEY).
 * Returns the same shape as FDC: { foods: [ { fdcId, description, foodNutrients, ... } ] }.
 * Results are cached for 10 minutes to speed up repeat and back-to-back searches.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    const apiKey = process.env.FDC_API_KEY ?? "DEMO_KEY";

    if (!q) {
      return NextResponse.json({ error: "Query q is required" }, { status: 400 });
    }

    const key = q.toLowerCase();
    const now = Date.now();
    const hit = searchCache.get(key);
    if (hit && now - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json(hit.data);
    }

    const url = `${FDC_BASE}/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(q)}&pageSize=20`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message ?? data.error ?? "USDA search failed" },
        { status: res.status >= 400 ? res.status : 500 }
      );
    }

    searchCache.set(key, { data, ts: now });
    pruneCache();
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to search USDA" }, { status: 500 });
  }
}
