"use client";

import { useCallback, useEffect, useState, lazy, Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/format";

const CameraBarcodeScanner = lazy(() => import("@/components/CameraBarcodeScanner"));

type Product = { id: number; sku: string; name: string; price: string; category?: string };

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

  const productsByCategory = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const key = (p.category ?? "").trim() || "Other";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    return Array.from(m.entries());
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
        showToast("Added to cart — tap Checkout when ready.");
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
        showToast("Added to cart.");
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
          their screen. When your gym turns on member scanning, you&apos;ll see the barcode flow here.
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
        Scan a barcode on drinks, shakes, or bars — then check out with your card on file, the front-desk reader, or Stripe.
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
          Checkout
        </Link>
      </div>

      {products.length === 0 ? (
        <p className="text-stone-500 text-sm">
          Nothing in the catalog yet. Ask the front desk once items are added in admin.
        </p>
      ) : (
        <div className="space-y-6">
          {productsByCategory.map(([cat, items]) => (
            <div key={cat}>
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-2 px-0.5">{cat}</h2>
              <ul className="space-y-2 border rounded-xl border-stone-200 divide-y divide-stone-100 bg-white">
                {items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                    <div>
                      <p className="font-medium text-stone-900">{p.name}</p>
                      <p className="text-xs text-stone-500">SKU {p.sku}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-stone-700 font-medium">{formatPrice(p.price)}</span>
                      <button
                        type="button"
                        disabled={addBusy}
                        onClick={() => addById(p.id)}
                        className="px-3 py-1.5 rounded-lg bg-stone-100 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {shopUrl ? (
        <details className="mt-8 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <summary className="cursor-pointer font-medium text-stone-800">QR code for the cooler</summary>
          <p className="mt-3 text-sm text-stone-600">
            Point a QR code at this URL so members land straight here. Use your favorite QR generator and print the label.
          </p>
          <input
            readOnly
            className="mt-2 w-full text-sm px-3 py-2 rounded-lg border border-stone-200 bg-white font-mono"
            value={shopUrl}
            onFocus={(e) => e.target.select()}
          />
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
