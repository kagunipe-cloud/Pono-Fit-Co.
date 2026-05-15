"use client";

import { useCallback, useEffect, useState, lazy, Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { formatPrice } from "@/lib/format";

const CameraBarcodeScanner = lazy(() => import("@/components/CameraBarcodeScanner"));

type Product = {
  id: number;
  name: string;
  price: string;
  category?: string;
  can_purchase: boolean;
};

export default function MemberRetailPage() {
  const router = useRouter();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selfCheckoutEnabled, setSelfCheckoutEnabled] = useState<boolean | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shopUrl, setShopUrl] = useState("");

  useEffect(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    setShopUrl(`${base}/member/retail`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meRes = await fetch("/api/auth/member-me");
      if (!meRes.ok) {
        router.replace("/login");
        return;
      }
      const me = await meRes.json().catch(() => null);
      if (!me?.member_id) {
        router.replace("/login");
        return;
      }
      if (cancelled) return;
      setMemberId(me.member_id);

      const accessRes = await fetch("/api/member/retail-access");
      const accessData = accessRes.ok ? await accessRes.json().catch(() => ({})) : {};
      if (cancelled) return;
      if (!accessData.member_self_checkout_enabled) {
        setSelfCheckoutEnabled(false);
        setLoading(false);
        return;
      }
      setSelfCheckoutEnabled(true);

      const catRes = await fetch("/api/member/retail-products");
      if (!catRes.ok) {
        if (!cancelled) {
          setError("Could not load the Pro Shop catalog.");
          setLoading(false);
        }
        return;
      }
      const data = await catRes.json().catch(() => ({}));
      if (cancelled) return;
      setProducts(Array.isArray(data.products) ? data.products : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  /** Preserve catalog order (by category sort, then names) — first-seen category defines section order */
  const productsByCategory = useMemo(() => {
    const map = new Map<string, Product[]>();
    const order: string[] = [];
    for (const p of products) {
      const key = (p.category ?? "").trim() || "Other";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(p);
    }
    return order.map((category) => [category, map.get(category)!] as const);
  }, [products]);

  const addBySku = useCallback(
    async (sku: string) => {
      if (!memberId || !sku.trim()) return;
      setAddBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ member_id: memberId, product_type: "retail", sku: sku.trim(), quantity: 1 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Could not add to cart");
        }
        showToast("Added to your cart — open Cart to complete payment.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add item");
      } finally {
        setAddBusy(false);
      }
    },
    [memberId, showToast]
  );

  const addById = useCallback(
    async (id: number) => {
      if (!memberId) return;
      setAddBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ member_id: memberId, product_type: "retail", product_id: id, quantity: 1 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Could not add to cart");
        }
        showToast("Added to your cart — open Cart to complete payment.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add item");
      } finally {
        setAddBusy(false);
      }
    },
    [memberId, showToast]
  );

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!memberId) return null;

  if (selfCheckoutEnabled === false) {
    return (
      <div className="max-w-lg mx-auto p-6">
        <h1 className="text-2xl font-bold text-stone-900 mb-2">Pro Shop</h1>
        <p className="text-stone-600 mb-4">
          Self-checkout for drinks, shakes, and bars is run by the front desk for now. Staff can add items to your cart from
          their screen.
        </p>
        <Link
          href="/member/cart"
          className="inline-flex px-5 py-3 rounded-xl border-2 border-stone-300 font-semibold text-stone-800 hover:bg-stone-50"
        >
          Open my cart
        </Link>
        <p className="mt-6 text-sm text-stone-500">
          <Link href="/member" className="text-brand-600 hover:underline">
            ← Member home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4 pb-24">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Pro Shop</h1>
      <p className="text-sm text-stone-600 mb-6">
        Browse by category below, tap <strong>Purchase</strong> to add to your cart, then pay with your card on file or Stripe —
        same as checkout everywhere else.
      </p>

      {toast && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{toast}</div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <button
          type="button"
          disabled={addBusy}
          onClick={() => setScanOpen(true)}
          className="px-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
        >
          Scan barcode
        </button>
        <Link
          href="/member/cart"
          className="inline-flex items-center px-5 py-3 rounded-xl border-2 border-stone-300 font-semibold text-stone-800 hover:bg-stone-50"
        >
          Cart &amp; pay
        </Link>
      </div>

      {products.length === 0 ? (
        <p className="text-stone-500 text-sm">
          Nothing in the catalog yet. Ask the front desk once items are added in admin.
        </p>
      ) : (
        <div className="space-y-2">
          {productsByCategory.map(([cat, items]) => (
            <details
              key={cat}
              className="group rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="cursor-pointer select-none flex items-center justify-between gap-3 px-4 py-3 font-semibold text-stone-900 hover:bg-stone-50 border-b border-transparent group-open:border-stone-100 list-none">
                <span>
                  <span>{cat}</span>
                  <span className="ml-2 text-sm font-normal text-stone-500">({items.length})</span>
                </span>
                <span className="text-stone-400 text-xs shrink-0 transition-transform group-open:rotate-180" aria-hidden>
                  ▼
                </span>
              </summary>
              <ul className="divide-y divide-stone-100">
                {items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900">{p.name}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-stone-700 font-medium">{formatPrice(p.price)}</span>
                      <button
                        type="button"
                        disabled={addBusy || !p.can_purchase}
                        onClick={() => void addById(p.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-45 disabled:pointer-events-none"
                      >
                        Purchase
                      </button>
                      {!p.can_purchase ? <span className="text-xs text-stone-500">Unavailable</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}

      {shopUrl ? (
        <details className="mt-8 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <summary className="cursor-pointer font-medium text-stone-800 [&::-webkit-details-marker]:hidden">
            Shop QR — print one code for posters or the cooler
          </summary>
          <div className="mt-4 space-y-3 text-sm text-stone-600">
            <p>
              Printing <strong className="text-stone-800">one QR</strong> pointing to this page lets members browse and checkout
              after they&apos;re logged in on their phone.
            </p>
            <div className="flex flex-col items-center gap-3 p-4 bg-white rounded-lg border border-stone-200">
              <QRCodeSVG value={shopUrl} size={200} level="M" includeMargin aria-label="QR code linking to Pro Shop" />
              <p className="text-xs text-stone-500 text-center">Screenshot or export from DevTools · or copy URL below.</p>
            </div>
            <label className="block text-xs font-medium text-stone-600 uppercase tracking-wide">URL</label>
            <input
              readOnly
              className="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 bg-white font-mono"
              value={shopUrl}
              onFocus={(e) => e.target.select()}
            />
          </div>
        </details>
      ) : null}

      {scanOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-900/70"
          onClick={() => !addBusy && setScanOpen(false)}
        >
          <div className="w-full sm:max-w-md bg-white sm:rounded-xl shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b border-stone-100 flex justify-between items-center">
              <h2 className="font-semibold text-stone-900">Scan product</h2>
              <button type="button" className="text-sm text-stone-500 hover:text-stone-800" onClick={() => setScanOpen(false)}>
                Close
              </button>
            </div>
            <Suspense fallback={<div className="p-8 text-center text-stone-500">Starting camera…</div>}>
              <CameraBarcodeScanner
                onScan={(code) => {
                  void addBySku(code);
                  setScanOpen(false);
                }}
                onClose={() => setScanOpen(false)}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
