"use client";

import { useEffect, useState, useRef, lazy, Suspense } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

const CameraBarcodeScanner = lazy(() => import("@/components/CameraBarcodeScanner"));

type Row = {
  id: number;
  sku: string;
  name: string;
  price: string;
  unit_cost: string | null;
  stock_quantity: number;
  active: number;
  created_at: string | null;
};

export default function AdminRetailProductsPage() {
  const [products, setProducts] = useState<Row[]>([]);
  const [memberSelfCheckout, setMemberSelfCheckout] = useState(false);
  const [toggleSaving, setToggleSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [saving, setSaving] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState<number | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState<"receive" | "shrink" | "adjustment" | "count">("receive");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [coolerQrUrl, setCoolerQrUrl] = useState("");
  const [skuScanOpen, setSkuScanOpen] = useState(false);
  const skuInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setCoolerQrUrl(`${window.location.origin}/member/retail`);
  }, []);

  async function load() {
    setError(null);
    const res = await fetch("/api/admin/retail-products");
    if (!res.ok) {
      setError(res.status === 401 ? "Admin sign-in required." : "Could not load inventory.");
      setProducts([]);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setProducts(Array.isArray(data.products) ? data.products : []);
    setMemberSelfCheckout(Boolean(data.member_self_checkout_enabled));
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  /** Keep SKU field ready for USB / Bluetooth scanners (next scan after save, or first scan on load). */
  useEffect(() => {
    if (loading) return;
    const id = window.setTimeout(() => skuInputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [loading]);

  async function saveMemberSelfCheckout(enabled: boolean) {
    setToggleSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/retail-self-checkout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_self_checkout_enabled: enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Update failed");
      setMemberSelfCheckout(Boolean(data.member_self_checkout_enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setToggleSaving(false);
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim() || !price.trim()) return;
    setSaving(true);
    setError(null);
    let added = false;
    try {
      const res = await fetch("/api/admin/retail-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: sku.trim(),
          name: name.trim(),
          price: price.trim(),
          ...(unitCost.trim() ? { unit_cost: unitCost.trim() } : {}),
          ...(initialStock.trim() ? { initial_stock: initialStock.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      added = true;
      setSku("");
      setName("");
      setPrice("");
      setUnitCost("");
      setInitialStock("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
      if (added) {
        setTimeout(() => skuInputRef.current?.focus(), 0);
      }
    }
  }

  async function toggleActive(p: Row) {
    setError(null);
    const next = p.active === 1 ? 0 : 1;
    const res = await fetch(`/api/admin/retail-products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next === 1 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Update failed");
      return;
    }
    await load();
  }

  async function saveUnitCost(p: Row, cost: string) {
    setError(null);
    const res = await fetch(`/api/admin/retail-products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit_cost: cost.trim() || "0" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Update failed");
      return;
    }
    await load();
  }

  async function submitInventoryAdjust() {
    if (adjustProductId == null) return;
    const delta = parseInt(adjustDelta, 10);
    if (Number.isNaN(delta) || delta === 0) {
      setError("Enter a non-zero whole number (positive to add, negative to remove).");
      return;
    }
    setAdjustBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/retail-products/${adjustProductId}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delta,
          reason: adjustReason,
          ...(adjustNote.trim() ? { note: adjustNote.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Adjust failed");
      setAdjustProductId(null);
      setAdjustDelta("");
      setAdjustNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjust failed");
    } finally {
      setAdjustBusy(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-700 mb-4 inline-block">
        ← Home
      </Link>
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Pro shop inventory</h1>
      <p className="text-stone-600 text-sm mb-4">
        Staff can always add retail to a member cart. Turn on member self-checkout when you are ready for the cooler QR / scan flow.
      </p>
      <p className="text-sm text-stone-600 mb-4 border-l-2 border-emerald-500 pl-3">
        <strong>Bulk add:</strong> you don&apos;t have to type SKUs — point a handheld scanner at the box below (or use{" "}
        <strong>Scan with camera</strong>), then enter name and price and click Add product. We keep the SKU field focused so you
        can scan the next item right away. Ring-up scanning is on each member&apos;s <strong>Cart</strong>; self-checkout is the
        toggle below.
      </p>

      <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50/80 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-stone-900">Member self-checkout (scan &amp; pay)</p>
          <p className="text-sm text-stone-600 mt-1">
            {memberSelfCheckout
              ? "Members see Pro shop on their home screen and can scan items themselves."
              : "Off by default — members will not see Pro shop; only staff add items from the member cart."}
          </p>
        </div>
        <button
          type="button"
          disabled={toggleSaving}
          onClick={() => saveMemberSelfCheckout(!memberSelfCheckout)}
          className={`px-4 py-2 rounded-lg text-sm font-medium shrink-0 ${
            memberSelfCheckout
              ? "bg-stone-200 text-stone-800 hover:bg-stone-300"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          } disabled:opacity-50`}
        >
          {toggleSaving ? "Saving…" : memberSelfCheckout ? "Turn off" : "Turn on"}
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}

      <form onSubmit={createProduct} className="mb-8 p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
        <h2 className="font-semibold text-stone-800">Add product</h2>
        <p className="text-xs text-stone-500 -mt-1">SKU is filled by scanning; you only type name and price.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <label className="block sm:col-span-2 lg:col-span-2">
            <span className="text-xs font-medium text-stone-600">SKU / barcode</span>
            <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">
              <strong className="text-stone-700">Phone:</strong> tap the green button — your browser asks to use the camera; after you allow, point at the barcode. The code fills the box below.{" "}
              <strong className="text-stone-700">Scanner gun:</strong> tap the box, then scan.
            </p>
            <div className="mt-1 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setSkuScanOpen(true)}
                className="w-full px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 shadow-sm sm:hidden"
              >
                Open camera — scan barcode for SKU
              </button>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={skuInputRef}
                  className="min-w-[12rem] flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono bg-white"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Barcode appears here after you scan"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setSkuScanOpen(true)}
                  className="hidden sm:inline-flex px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 shrink-0"
                >
                  Scan with camera
                </button>
              </div>
            </div>
            <span className="text-[11px] text-stone-500 mt-1 block sm:hidden">
              The app can&apos;t use your camera until you tap that button — browsers require it for privacy.
            </span>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-stone-600">Name</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Energy drink — flavor"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600">Sell price</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="3.50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600">Unit cost (optional)</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="2.00"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600">Initial stock (optional)</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
              value={initialStock}
              onChange={(e) => setInitialStock(e.target.value)}
              placeholder="24"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add product"}
        </button>
      </form>

      <h2 className="font-semibold text-stone-800 mb-2">All items</h2>
      {products.length === 0 ? (
        <p className="text-stone-500 text-sm">No products yet.</p>
      ) : (
        <ul className="border rounded-xl border-stone-200 divide-y divide-stone-100">
          {products.map((p) => (
            <li key={p.id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-stone-900">
                    {p.name}{" "}
                    <span className={`text-xs font-normal ${p.active ? "text-emerald-700" : "text-stone-400"}`}>
                      ({p.active ? "active" : "inactive"})
                    </span>
                  </p>
                  <p className="text-xs text-stone-500">SKU {p.sku}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-stone-700">
                    Sell <strong>{formatPrice(p.price)}</strong>
                  </span>
                  <span className="text-stone-500">|</span>
                  <span>
                    Cost{" "}
                    <InlineCost
                      value={p.unit_cost ?? "0.00"}
                      onSave={(v) => saveUnitCost(p, v)}
                    />
                  </span>
                  <span className="text-stone-500">|</span>
                  <span className="font-medium text-stone-800">{Math.max(0, Number(p.stock_quantity) || 0)} in stock</span>
                  <button type="button" onClick={() => toggleActive(p)} className="text-brand-600 font-medium hover:underline ml-2">
                    {p.active === 1 ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdjustProductId(p.id);
                    setAdjustReason("receive");
                    setAdjustDelta("");
                    setAdjustNote("");
                  }}
                  className="text-sm px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-900 font-medium hover:bg-emerald-200"
                >
                  Receive / adjust stock
                </button>
              </div>
              {adjustProductId === p.id && (
                <div className="p-3 rounded-lg border border-stone-200 bg-white space-y-2">
                  <p className="text-xs text-stone-600">
                    Use positive numbers to receive product (adds to stock). Use negative numbers to mark out waste, samples,
                    or shrinkage (removes from stock). Sales remove stock automatically at checkout.
                  </p>
                  <div className="flex flex-wrap gap-2 items-end">
                    <label className="block">
                      <span className="text-xs text-stone-600">Δ units</span>
                      <input
                        className="mt-0.5 w-24 px-2 py-1.5 rounded border border-stone-200 text-sm"
                        value={adjustDelta}
                        onChange={(e) => setAdjustDelta(e.target.value)}
                        placeholder="-2 or 12"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-stone-600">Reason</span>
                      <select
                        className="mt-0.5 px-2 py-1.5 rounded border border-stone-200 text-sm block"
                        value={adjustReason}
                        onChange={(e) => setAdjustReason(e.target.value as typeof adjustReason)}
                      >
                        <option value="receive">Receive</option>
                        <option value="shrink">Shrink / mark out</option>
                        <option value="adjustment">Adjustment</option>
                        <option value="count">Physical count</option>
                      </select>
                    </label>
                    <label className="block flex-1 min-w-[160px]">
                      <span className="text-xs text-stone-600">Note (optional)</span>
                      <input
                        className="mt-0.5 w-full px-2 py-1.5 rounded border border-stone-200 text-sm"
                        value={adjustNote}
                        onChange={(e) => setAdjustNote(e.target.value)}
                        placeholder="e.g. damaged case"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={adjustBusy}
                      onClick={() => void submitInventoryAdjust()}
                      className="px-3 py-2 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-900 disabled:opacity-50"
                    >
                      {adjustBusy ? "Applying…" : "Apply"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustProductId(null)}
                      className="px-3 py-2 text-sm text-stone-600 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {memberSelfCheckout && coolerQrUrl ? (
        <p className="mt-8 text-sm text-stone-500">
          Cooler QR URL for members: <span className="font-mono text-stone-700">{coolerQrUrl}</span>
        </p>
      ) : null}

      {skuScanOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-900/70"
          onClick={() => setSkuScanOpen(false)}
        >
          <div className="w-full sm:max-w-md bg-white sm:rounded-xl shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b border-stone-100 flex justify-between items-center">
              <h2 className="font-semibold text-stone-900">Scan barcode for SKU</h2>
              <button type="button" className="text-sm text-stone-500 hover:text-stone-800" onClick={() => setSkuScanOpen(false)}>
                Close
              </button>
            </div>
            <Suspense fallback={<div className="p-8 text-center text-stone-500">Starting camera…</div>}>
              <CameraBarcodeScanner
                onScan={(code) => {
                  setSku(code.trim());
                  setSkuScanOpen(false);
                  skuInputRef.current?.focus();
                }}
                onClose={() => setSkuScanOpen(false)}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineCost({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  if (!edit) {
    return (
      <button type="button" className="text-brand-600 hover:underline font-medium" onClick={() => setEdit(true)}>
        {formatPrice(value)}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        className="w-20 px-1 py-0.5 border rounded text-sm"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        autoFocus
      />
      <button
        type="button"
        className="text-xs text-brand-600 hover:underline"
        onClick={() => {
          onSave(local);
          setEdit(false);
        }}
      >
        Save
      </button>
      <button type="button" className="text-xs text-stone-500 hover:underline" onClick={() => setEdit(false)}>
        Cancel
      </button>
    </span>
  );
}
