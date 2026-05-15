"use client";

import { useEffect, useState, useRef, lazy, Suspense } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { formatPrice } from "@/lib/format";

const CameraBarcodeScanner = lazy(() => import("@/components/CameraBarcodeScanner"));

type Category = { id: number; name: string; sort_order: number };
type VariantRow = {
  id: number;
  sku: string;
  name: string;
  stock_quantity: number;
  active: number;
  created_at: string | null;
};
type ProductGroup = {
  id: number;
  category_id: number | null;
  category_name: string | null;
  display_name: string;
  price: string;
  unit_cost: string | null;
  active: number;
  created_at: string | null;
  variants: VariantRow[];
};
type ItemRow = { sku: string; name: string; stock: string };
type StandaloneRow = {
  id: number;
  sku: string;
  name: string;
  price: string;
  unit_cost: string | null;
  stock_quantity: number;
  active: number;
  created_at: string | null;
  category_id: number | null;
  category_name: string | null;
};

type GroupEdit = {
  display_name: string;
  category_id: string;
  price: string;
  unit_cost: string;
  active: boolean;
};

export default function AdminRetailProductsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [standalone, setStandalone] = useState<StandaloneRow[]>([]);
  const [groupEdits, setGroupEdits] = useState<Record<number, GroupEdit>>({});
  const [memberSelfCheckout, setMemberSelfCheckout] = useState(false);
  const [allowPurchaseWhenOutOfStock, setAllowPurchaseWhenOutOfStock] = useState(false);
  const [toggleSaving, setToggleSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCatName, setNewCatName] = useState("");
  const [newCatSort, setNewCatSort] = useState("");

  const [itemCategoryId, setItemCategoryId] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemUnitCost, setItemUnitCost] = useState("");
  const [itemGroupDisplayName, setItemGroupDisplayName] = useState("");
  const [itemRows, setItemRows] = useState<ItemRow[]>([{ sku: "", name: "", stock: "" }]);
  const [itemSaving, setItemSaving] = useState(false);
  const [skuScanRowIdx, setSkuScanRowIdx] = useState(0);

  const [addVarGroupId, setAddVarGroupId] = useState("");
  const [addVarSku, setAddVarSku] = useState("");
  const [addVarName, setAddVarName] = useState("");
  const [addVarStock, setAddVarStock] = useState("");
  const [addVarBusy, setAddVarBusy] = useState(false);

  const [adjustProductId, setAdjustProductId] = useState<number | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState<"receive" | "shrink" | "adjustment" | "count">("receive");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [coolerQrUrl, setCoolerQrUrl] = useState("");
  const [skuScanOpen, setSkuScanOpen] = useState(false);
  const firstSkuInputRef = useRef<HTMLInputElement | null>(null);
  const [groupPatchBusy, setGroupPatchBusy] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setCoolerQrUrl(`${window.location.origin}/member/retail`);
  }, []);

  async function load() {
    setError(null);
    const res = await fetch("/api/admin/retail-products");
    if (!res.ok) {
      setError(res.status === 401 ? "Admin sign-in required." : "Could not load inventory.");
      setCategories([]);
      setGroups([]);
      setStandalone([]);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setCategories(Array.isArray(data.categories) ? data.categories : []);
    setGroups(Array.isArray(data.groups) ? data.groups : []);
    setStandalone(Array.isArray(data.standalone_products) ? data.standalone_products : []);
    setMemberSelfCheckout(Boolean(data.member_self_checkout_enabled));
    setAllowPurchaseWhenOutOfStock(Boolean(data.member_allow_purchase_when_out_of_stock));
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const next: Record<number, GroupEdit> = {};
    for (const g of groups) {
      next[g.id] = {
        display_name: g.display_name,
        category_id: g.category_id != null ? String(g.category_id) : "",
        price: g.price,
        unit_cost: g.unit_cost ?? "",
        active: g.active === 1,
      };
    }
    setGroupEdits(next);
  }, [groups]);

  useEffect(() => {
    if (loading) return;
    const id = window.setTimeout(() => firstSkuInputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [loading]);

  async function patchProShopSettings(partial: {
    member_self_checkout_enabled?: boolean;
    member_allow_purchase_when_out_of_stock?: boolean;
  }) {
    setToggleSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/retail-self-checkout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Update failed");
      setMemberSelfCheckout(Boolean(data.member_self_checkout_enabled));
      setAllowPurchaseWhenOutOfStock(Boolean(data.member_allow_purchase_when_out_of_stock));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setToggleSaving(false);
    }
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setError(null);
    const res = await fetch("/api/admin/retail-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newCatName.trim(),
        ...(newCatSort.trim() ? { sort_order: parseInt(newCatSort, 10) } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Could not add category");
      return;
    }
    setNewCatName("");
    setNewCatSort("");
    await load();
  }

  async function deleteCategory(id: number) {
    if (!confirm("Delete this category? Products and groups using it must be reassigned first.")) return;
    setError(null);
    const res = await fetch(`/api/admin/retail-categories/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Could not delete");
      return;
    }
    await load();
  }

  async function submitAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!itemPrice.trim()) {
      setError("Enter a sell price.");
      return;
    }
    const valid = itemRows
      .map((r) => ({
        sku: r.sku.trim(),
        name: r.name.trim(),
        stock: r.stock.trim(),
      }))
      .filter((r) => r.sku && r.name);
    if (valid.length < 1) {
      setError("Add at least one row with SKU and name.");
      return;
    }
    if (valid.length >= 2 && !itemGroupDisplayName.trim()) {
      setError("Enter a line name for items with multiple SKUs (e.g. brand + pack size).");
      return;
    }
    setItemSaving(true);
    setError(null);
    let added = false;
    try {
      if (valid.length === 1) {
        const res = await fetch("/api/admin/retail-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: valid[0].sku,
            name: valid[0].name,
            price: itemPrice.trim(),
            ...(itemUnitCost.trim() ? { unit_cost: itemUnitCost.trim() } : {}),
            ...(valid[0].stock ? { initial_stock: valid[0].stock } : {}),
            ...(itemCategoryId ? { category_id: parseInt(itemCategoryId, 10) } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      } else {
        const res = await fetch("/api/admin/retail-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "group",
            display_name: itemGroupDisplayName.trim(),
            price: itemPrice.trim(),
            ...(itemUnitCost.trim() ? { unit_cost: itemUnitCost.trim() } : {}),
            ...(itemCategoryId ? { category_id: parseInt(itemCategoryId, 10) } : {}),
            variants: valid.map((r) => ({
              sku: r.sku,
              name: r.name,
              ...(r.stock ? { initial_stock: r.stock } : {}),
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      }
      added = true;
      setItemCategoryId("");
      setItemPrice("");
      setItemUnitCost("");
      setItemGroupDisplayName("");
      setItemRows([{ sku: "", name: "", stock: "" }]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setItemSaving(false);
      if (added) setTimeout(() => firstSkuInputRef.current?.focus(), 0);
    }
  }

  async function saveGroupPatch(groupId: number) {
    const ed = groupEdits[groupId];
    if (!ed) return;
    setGroupPatchBusy(groupId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/retail-product-groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: ed.display_name.trim(),
          price: ed.price.trim(),
          unit_cost: ed.unit_cost.trim() || "0",
          active: ed.active,
          ...(ed.category_id ? { category_id: parseInt(ed.category_id, 10) } : { category_id: null }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Update failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setGroupPatchBusy(null);
    }
  }

  async function submitAddVariant(e: React.FormEvent) {
    e.preventDefault();
    const gid = parseInt(addVarGroupId, 10);
    if (!Number.isFinite(gid) || !addVarSku.trim() || !addVarName.trim()) return;
    setAddVarBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/retail-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "variant",
          group_id: gid,
          sku: addVarSku.trim(),
          name: addVarName.trim(),
          ...(addVarStock.trim() ? { initial_stock: addVarStock.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Save failed");
      setAddVarGroupId("");
      setAddVarSku("");
      setAddVarName("");
      setAddVarStock("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setAddVarBusy(false);
    }
  }

  function openSkuScan(rowIdx: number) {
    setSkuScanRowIdx(rowIdx);
    setSkuScanOpen(true);
  }

  async function patchStandaloneCategory(p: StandaloneRow, categoryIdStr: string) {
    setError(null);
    const body =
      categoryIdStr === "" ? { category_id: null } : { category_id: parseInt(categoryIdStr, 10) };
    const res = await fetch(`/api/admin/retail-products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Update failed");
      return;
    }
    await load();
  }

  async function toggleActive(p: StandaloneRow | VariantRow) {
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

  async function saveUnitCost(p: StandaloneRow, cost: string) {
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

  function updateGroupEdit(id: number, patch: Partial<GroupEdit>) {
    setGroupEdits((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  }

  function renderAdjustPanel(productId: number) {
    if (adjustProductId !== productId) return null;
    return (
      <div className="p-3 rounded-lg border border-stone-200 bg-white space-y-2 mt-2">
        <p className="text-xs text-stone-600">
          Positive = receive, negative = shrink. Sales adjust stock at checkout automatically.
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
          <button type="button" onClick={() => setAdjustProductId(null)} className="px-3 py-2 text-sm text-stone-600 hover:underline">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-700 mb-4 inline-block">
        ← Home
      </Link>
      <h1 className="text-2xl font-bold text-stone-900 mb-1">Pro Shop Inventory</h1>
      <p className="text-stone-600 text-sm mb-4">
        Use <strong>Add item</strong> for everything new: one SKU is a standalone product; use <strong>Add variation</strong> when several SKUs
        share the same price and cost (e.g. flavors). Pick a <strong>category</strong> so items group nicely in the member Pro Shop.
      </p>

      <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50/80 space-y-5">
        <div>
          <h2 className="text-sm font-bold text-amber-950 uppercase tracking-wide">Pro Shop settings</h2>
          <p className="text-xs text-amber-900/80 mt-1">Controls how members use the self-serve shop and catalog.</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-amber-200/70 pt-4">
          <div>
            <p className="font-semibold text-stone-900">Member self-checkout</p>
            <p className="text-sm text-stone-600 mt-1">
              {memberSelfCheckout
                ? "Members see Pro Shop on their home screen and can browse, scan, or purchase from the catalog."
                : "Off by default — members will not see Pro Shop; only staff add items from the member cart."}
            </p>
          </div>
          <button
            type="button"
            disabled={toggleSaving}
            onClick={() => void patchProShopSettings({ member_self_checkout_enabled: !memberSelfCheckout })}
            className={`px-4 py-2 rounded-lg text-sm font-medium shrink-0 ${
              memberSelfCheckout ? "bg-stone-200 text-stone-800 hover:bg-stone-300" : "bg-emerald-600 text-white hover:bg-emerald-700"
            } disabled:opacity-50`}
          >
            {toggleSaving ? "Saving…" : memberSelfCheckout ? "Turn off" : "Turn on"}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-amber-200/70 pt-4">
          <div>
            <p className="font-semibold text-stone-900">Purchases when inventory is zero or below</p>
            <p className="text-sm text-stone-600 mt-1">
              {allowPurchaseWhenOutOfStock
                ? "Members can still add items and pay while stock is at or below zero (for example if the cooler is restocked shortly after). Staff adding from the cart always checks real stock."
                : `Members cannot purchase a product from the Pro Shop until inventory is above zero. They will see "Unavailable" instead of a SKU or count.`}
            </p>
          </div>
          <button
            type="button"
            disabled={toggleSaving}
            onClick={() =>
              void patchProShopSettings({
                member_allow_purchase_when_out_of_stock: !allowPurchaseWhenOutOfStock,
              })
            }
            className={`px-4 py-2 rounded-lg text-sm font-medium shrink-0 ${
              allowPurchaseWhenOutOfStock
                ? "bg-amber-700 text-white hover:bg-amber-800"
                : "bg-white border-2 border-stone-300 text-stone-800 hover:bg-stone-50"
            } disabled:opacity-50`}
          >
            {toggleSaving ? "Saving…" : allowPurchaseWhenOutOfStock ? "Disallow when out of stock" : "Allow when out of stock"}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}

      <form onSubmit={submitAddItem} className="mb-8 p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-3">
        <h2 className="font-semibold text-stone-800">Add item</h2>
        <p className="text-xs text-stone-600">
          One row → standalone product. <strong>Add variation</strong> for more SKUs at the same sell price and unit cost (creates a product group).
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-stone-600">Category</span>
            <select
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white"
              value={itemCategoryId}
              onChange={(e) => setItemCategoryId(e.target.value)}
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600">Sell price (all rows)</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white"
              value={itemPrice}
              onChange={(e) => setItemPrice(e.target.value)}
              placeholder="3.50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-600">Unit cost (optional)</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white"
              value={itemUnitCost}
              onChange={(e) => setItemUnitCost(e.target.value)}
              placeholder="2.00"
            />
          </label>
          {itemRows.length > 1 ? (
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-stone-600">Line name (brand / product — shared by all SKUs)</span>
              <input
                className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white"
                value={itemGroupDisplayName}
                onChange={(e) => setItemGroupDisplayName(e.target.value)}
                placeholder="e.g. Aloha Protein Bar 2.1oz"
              />
            </label>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-stone-600">SKU, label, initial stock</p>
          {itemRows.length > 1 ? (
            <p className="text-xs text-stone-500">
              Each row is a different barcode; <strong>Name</strong> is the variant label (e.g. chocolate).
            </p>
          ) : (
            <p className="text-xs text-stone-500">
              <strong>Name</strong> is what members see for this SKU.
            </p>
          )}
          {itemRows.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-end">
              <label className="block min-w-[10rem] flex-1">
                <span className="text-xs text-stone-600">SKU / barcode</span>
                <div className="mt-0.5 flex flex-wrap gap-2">
                  <input
                    ref={i === 0 ? firstSkuInputRef : undefined}
                    className="min-w-[8rem] flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono bg-white"
                    placeholder="Scan or type"
                    value={row.sku}
                    onChange={(e) => {
                      const next = [...itemRows];
                      next[i] = { ...next[i], sku: e.target.value };
                      setItemRows(next);
                    }}
                    onFocus={() => setSkuScanRowIdx(i)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => openSkuScan(i)}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 shrink-0"
                  >
                    Scan
                  </button>
                </div>
              </label>
              <label className="block min-w-[8rem] flex-1">
                <span className="text-xs text-stone-600">Name</span>
                <input
                  className="mt-0.5 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white"
                  placeholder={itemRows.length > 1 ? "e.g. Peanut butter" : "Product name"}
                  value={row.name}
                  onChange={(e) => {
                    const next = [...itemRows];
                    next[i] = { ...next[i], name: e.target.value };
                    setItemRows(next);
                  }}
                />
              </label>
              <label className="block w-24">
                <span className="text-xs text-stone-600">Stock</span>
                <input
                  className="mt-0.5 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white"
                  placeholder="0"
                  value={row.stock}
                  onChange={(e) => {
                    const next = [...itemRows];
                    next[i] = { ...next[i], stock: e.target.value };
                    setItemRows(next);
                  }}
                />
              </label>
              {itemRows.length > 1 ? (
                <button
                  type="button"
                  className="text-sm text-red-600 hover:underline pb-2"
                  onClick={() => {
                    setItemRows((prev) => {
                      const next = prev.filter((_, j) => j !== i);
                      setSkuScanRowIdx((idx) => (idx >= next.length ? Math.max(0, next.length - 1) : idx));
                      return next;
                    });
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="text-sm text-emerald-700 font-medium hover:underline"
            onClick={() => setItemRows([...itemRows, { sku: "", name: "", stock: "" }])}
          >
            + Add variation
          </button>
        </div>
        <button
          type="submit"
          disabled={itemSaving}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {itemSaving ? "Saving…" : "Save item"}
        </button>
      </form>

      <section className="mb-8 p-4 rounded-xl border border-stone-200 bg-white space-y-3">
        <h2 className="font-semibold text-stone-800">Add category</h2>
        <p className="text-xs text-stone-500">Used to group items in the member Pro Shop list. Lower sort = earlier in the list.</p>
        <form onSubmit={addCategory} className="flex flex-wrap gap-2 items-end">
          <label className="block flex-1 min-w-[140px]">
            <span className="text-xs font-medium text-stone-600">New category</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Drinks, Protein bars…"
            />
          </label>
          <label className="block w-24">
            <span className="text-xs font-medium text-stone-600">Sort</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
              value={newCatSort}
              onChange={(e) => setNewCatSort(e.target.value)}
              placeholder="0"
            />
          </label>
          <button type="submit" className="px-4 py-2 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-900">
            Add category
          </button>
        </form>
        {categories.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-2">
            {categories.map((c) => (
              <li key={c.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-stone-100 text-sm text-stone-800">
                {c.name}
                <span className="text-stone-400 text-xs">({c.sort_order})</span>
                <button type="button" onClick={() => void deleteCategory(c.id)} className="text-red-600 hover:underline text-xs">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {groups.length > 0 && (
        <section className="mb-8 space-y-4">
          <h2 className="font-semibold text-stone-800">Product groups</h2>
          {groups.map((g) => {
            const ed = groupEdits[g.id];
            if (!ed) return null;
            return (
              <div key={g.id} className="rounded-xl border border-stone-200 bg-stone-50/80 p-4 space-y-3">
                <div className="flex flex-wrap gap-3 items-start justify-between">
                  <p className="text-xs text-stone-500">
                    {g.category_name ? <span className="font-medium text-stone-700">{g.category_name}</span> : "Uncategorized"}
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={ed.active} onChange={(e) => updateGroupEdit(g.id, { active: e.target.checked })} />
                    Group active
                  </label>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <label className="block sm:col-span-2">
                    <span className="text-xs text-stone-600">Display name</span>
                    <input
                      className="mt-0.5 w-full px-2 py-1.5 rounded border border-stone-200 text-sm bg-white"
                      value={ed.display_name}
                      onChange={(e) => updateGroupEdit(g.id, { display_name: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-stone-600">Category</span>
                    <select
                      className="mt-0.5 w-full px-2 py-1.5 rounded border border-stone-200 text-sm bg-white"
                      value={ed.category_id}
                      onChange={(e) => updateGroupEdit(g.id, { category_id: e.target.value })}
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-stone-600">Sell price</span>
                    <input
                      className="mt-0.5 w-full px-2 py-1.5 rounded border border-stone-200 text-sm bg-white"
                      value={ed.price}
                      onChange={(e) => updateGroupEdit(g.id, { price: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-stone-600">Unit cost</span>
                    <input
                      className="mt-0.5 w-full px-2 py-1.5 rounded border border-stone-200 text-sm bg-white"
                      value={ed.unit_cost}
                      onChange={(e) => updateGroupEdit(g.id, { unit_cost: e.target.value })}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={groupPatchBusy === g.id}
                  onClick={() => void saveGroupPatch(g.id)}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {groupPatchBusy === g.id ? "Saving…" : "Save group pricing & category"}
                </button>

                <div className="border-t border-stone-200 pt-3">
                  <p className="text-xs font-medium text-stone-600 mb-2">SKUs in this group</p>
                  <ul className="space-y-2">
                    {g.variants.map((v) => (
                      <li key={v.id} className="bg-white rounded-lg border border-stone-100 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span className="font-medium text-stone-900">{v.name}</span>
                          <span className="text-xs font-mono text-stone-500">{v.sku}</span>
                          <span className="text-stone-700">{Math.max(0, Number(v.stock_quantity) || 0)} in stock</span>
                          <span className={`text-xs ${v.active ? "text-emerald-700" : "text-stone-400"}`}>
                            {v.active ? "active" : "inactive"}
                          </span>
                          <button type="button" onClick={() => void toggleActive(v)} className="text-brand-600 hover:underline text-xs">
                            {v.active ? "Deactivate SKU" : "Activate SKU"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAdjustProductId(v.id);
                              setAdjustReason("receive");
                              setAdjustDelta("");
                              setAdjustNote("");
                            }}
                            className="text-xs text-emerald-700 hover:underline"
                          >
                            Adjust stock
                          </button>
                        </div>
                        {renderAdjustPanel(v.id)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <details className="mb-8 group">
        <summary className="cursor-pointer text-sm font-medium text-stone-700 hover:text-stone-900 py-2">
          Add variant to an existing group…
        </summary>
        <form onSubmit={submitAddVariant} className="mt-2 p-4 rounded-xl border border-stone-200 bg-white space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            <label className="block min-w-[200px]">
              <span className="text-xs font-medium text-stone-600">Product group</span>
              <select
                className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                value={addVarGroupId}
                onChange={(e) => setAddVarGroupId(e.target.value)}
              >
                <option value="">Select…</option>
                {groups.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.display_name}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="px-3 py-2 rounded-lg border border-stone-200 text-sm font-mono min-w-[8rem]"
              placeholder="SKU"
              value={addVarSku}
              onChange={(e) => setAddVarSku(e.target.value)}
            />
            <input
              className="px-3 py-2 rounded-lg border border-stone-200 text-sm min-w-[8rem] flex-1"
              placeholder="Variant name"
              value={addVarName}
              onChange={(e) => setAddVarName(e.target.value)}
            />
            <input
              className="w-24 px-3 py-2 rounded-lg border border-stone-200 text-sm"
              placeholder="Stock"
              value={addVarStock}
              onChange={(e) => setAddVarStock(e.target.value)}
            />
            <button
              type="submit"
              disabled={addVarBusy}
              className="px-4 py-2 rounded-lg bg-stone-800 text-white text-sm font-medium hover:bg-stone-900 disabled:opacity-50"
            >
              Add variant
            </button>
          </div>
        </form>
      </details>

      <h2 className="font-semibold text-stone-800 mb-2">Standalone items</h2>
      {standalone.length === 0 ? (
        <p className="text-stone-500 text-sm mb-8">No standalone products. Use product groups above for multi-SKU items.</p>
      ) : (
        <ul className="border rounded-xl border-stone-200 divide-y divide-stone-100 mb-8">
          {standalone.map((p) => (
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
                  <label className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-stone-600">Category</span>
                    <select
                      className="py-1 px-2 rounded border border-stone-200 bg-white text-xs"
                      value={p.category_id != null ? String(p.category_id) : ""}
                      onChange={(e) => void patchStandaloneCategory(p, e.target.value)}
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-stone-700">
                    Sell <strong>{formatPrice(p.price)}</strong>
                  </span>
                  <span className="text-stone-500">|</span>
                  <span>
                    Cost{" "}
                    <InlineCost value={p.unit_cost ?? "0.00"} onSave={(v) => void saveUnitCost(p, v)} />
                  </span>
                  <span className="text-stone-500">|</span>
                  <span className="font-medium text-stone-800">{Math.max(0, Number(p.stock_quantity) || 0)} in stock</span>
                  <button type="button" onClick={() => void toggleActive(p)} className="text-brand-600 font-medium hover:underline ml-2">
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
              {renderAdjustPanel(p.id)}
            </li>
          ))}
        </ul>
      )}

      {memberSelfCheckout && coolerQrUrl ? (
        <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 max-w-md">
          <p className="text-sm font-semibold text-emerald-900 mb-3">Printable Pro Shop QR (member shop URL)</p>
          <div className="flex flex-col sm:flex-row gap-5 items-start">
            <div className="shrink-0 rounded-lg bg-white p-3 border border-stone-200">
              <QRCodeSVG value={coolerQrUrl} size={176} level="M" includeMargin aria-label="QR code for member Pro Shop" />
            </div>
            <div className="min-w-0 flex-1 text-sm text-stone-600 space-y-2">
              <p>Members open this page (signed in) to browse by category and add items to their cart.</p>
              <p className="font-mono text-xs text-stone-800 break-all">{coolerQrUrl}</p>
            </div>
          </div>
        </div>
      ) : null}

      {skuScanOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-900/70"
          onClick={() => setSkuScanOpen(false)}
        >
          <div className="w-full sm:max-w-md bg-white sm:rounded-xl shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b border-stone-100 flex justify-between items-center">
              <h2 className="font-semibold text-stone-900">Scan barcode</h2>
              <button type="button" className="text-sm text-stone-500 hover:text-stone-800" onClick={() => setSkuScanOpen(false)}>
                Close
              </button>
            </div>
            <Suspense fallback={<div className="p-8 text-center text-stone-500">Starting camera…</div>}>
              <CameraBarcodeScanner
                onScan={(code) => {
                  const trimmed = code.trim();
                  setItemRows((prev) => {
                    const next = [...prev];
                    const i = Math.min(skuScanRowIdx, Math.max(0, next.length - 1));
                    if (next[i]) next[i] = { ...next[i], sku: trimmed };
                    return next;
                  });
                  setSkuScanOpen(false);
                  firstSkuInputRef.current?.focus();
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
      <input className="w-20 px-1 py-0.5 border rounded text-sm" value={local} onChange={(e) => setLocal(e.target.value)} autoFocus />
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
