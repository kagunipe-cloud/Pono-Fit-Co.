import { NextRequest, NextResponse } from "next/server";
import { searchOFF, normalizeOFFProduct } from "@/lib/openfoodfacts";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 300;

type CacheEntry = { data: { count: number; foods: unknown[] }; ts: number };
const searchCache = new Map<string, CacheEntry>();

function pruneCache() {
  if (searchCache.size <= CACHE_MAX) return;
  const entries = [...searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = entries.slice(0, searchCache.size - CACHE_MAX);
  toRemove.forEach(([k]) => searchCache.delete(k));
}

/**
 * GET ?q= — search Open Food Facts. Returns normalized foods (name, barcode, macros, serving).
 * Rate limit: 10 req/min on OFF side; results cached 10 min to reduce calls.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    const pageSize = Math.min(50, parseInt(searchParams.get("page_size") ?? "20", 10) || 20);

    if (!q) {
      return NextResponse.json({ error: "Query q is required" }, { status: 400 });
    }

    const key = `${q.toLowerCase()}:${pageSize}`;
    const now = Date.now();
    const hit = searchCache.get(key);
    if (hit && now - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json(hit.data);
    }

    const { count, products } = await searchOFF(q, pageSize);
    const normalized = products
      .map((p) => normalizeOFFProduct(p))
      .filter((f): f is NonNullable<typeof f> => {
        if (f == null) return false;
        const n = f.name?.trim().toLowerCase() ?? "";
        if (n === "" || n === "unknown product" || n === "unknown products") return false;
        if (n.startsWith("unknown product ") || n.startsWith("unknown products ")) return false;
        return true;
      });

    const data = { count, foods: normalized };
    searchCache.set(key, { data, ts: now });
    pruneCache();
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Open Food Facts search failed" }, { status: 500 });
  }
}
