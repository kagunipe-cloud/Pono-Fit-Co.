"use client";

import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const CameraBarcodeScanner = lazy(() => import("@/components/CameraBarcodeScanner"));

const FETCH_TIMEOUT_MS = 25_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

type Favorite = { id: number; name: string; created_at?: string; items: { food_id: number; amount: number; food_name: string }[] };
type OFFProduct = { name: string; barcode: string; calories: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null };

export default function ManageFavoritesPage() {
  const router = useRouter();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState<Favorite | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Favorite | null>(null);

  const fetchFavorites = useCallback(() => {
    fetch("/api/member/favorites")
      .then((r) => {
        if (r.status === 401) router.replace("/login");
        return r.ok ? r.json() : [];
      })
      .then((list: Favorite[]) => setFavorites(Array.isArray(list) ? list : []))
      .catch(() => setFavorites([]))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const filtered = search.trim()
    ? favorites.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : favorites;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/member/macros" className="text-brand-600 hover:underline text-sm mb-1 inline-block">← Macros</Link>
          <h1 className="text-2xl font-bold text-stone-800">Manage Favorites</h1>
          <p className="text-stone-600 text-sm mt-0.5">Add, edit, or delete your saved favorites. Use barcode or AI to add foods.</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search favorites…"
          className="flex-1 px-3 py-2 rounded-lg border border-stone-200"
        />
        <button
          type="button"
          onClick={() => setAddModal(true)}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
        >
          + Add Favorite
        </button>
      </div>

      {loading ? (
        <p className="text-stone-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-stone-500 py-8">
          {search.trim() ? "No favorites match your search." : "No favorites yet. Add one with the button above."}
        </p>
      ) : (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-stone-700">Name</th>
                <th className="text-left px-4 py-3 font-medium text-stone-700">Items</th>
                <th className="text-right px-4 py-3 font-medium text-stone-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((fav) => (
                <tr key={fav.id} className="hover:bg-stone-50/50">
                  <td className="px-4 py-3 font-medium text-stone-800">{fav.name}</td>
                  <td className="px-4 py-3 text-stone-600">
                    {fav.items.length === 0
                      ? "—"
                      : fav.items.map((i) => `${i.food_name} (×${i.amount})`).join(", ")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditModal(fav)}
                      className="text-brand-600 hover:underline mr-3"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(fav)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addModal && (
        <AddEditFavoriteModal
          mode="add"
          onClose={() => setAddModal(false)}
          onSaved={() => {
            setAddModal(false);
            fetchFavorites();
          }}
          fetchWithTimeout={fetchWithTimeout}
        />
      )}
      {editModal && (
        <AddEditFavoriteModal
          mode="edit"
          initial={editModal}
          onClose={() => setEditModal(null)}
          onSaved={() => {
            setEditModal(null);
            fetchFavorites();
          }}
          fetchWithTimeout={fetchWithTimeout}
        />
      )}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-stone-800 mb-2">Delete &quot;{deleteConfirm.name}&quot;?</h2>
            <p className="text-stone-600 text-sm mb-4">This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const r = await fetch(`/api/member/favorites/${deleteConfirm.id}`, { method: "DELETE" });
                  if (r.ok) {
                    setDeleteConfirm(null);
                    fetchFavorites();
                  } else {
                    alert("Failed to delete");
                  }
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
              >
                Delete
              </button>
              <button type="button" onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type PendingItem = { food_id: number; food_name: string; amount: number };

function AddEditFavoriteModal({
  mode,
  initial,
  onClose,
  onSaved,
  fetchWithTimeout,
}: {
  mode: "add" | "edit";
  initial?: Favorite;
  onClose: () => void;
  onSaved: () => void;
  fetchWithTimeout: (url: string, options?: RequestInit) => Promise<Response>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [items, setItems] = useState<PendingItem[]>(
    initial?.items?.map((i) => ({ food_id: i.food_id, food_name: i.food_name, amount: i.amount })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Barcode
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeNotFound, setBarcodeNotFound] = useState(false);
  const [barcodePending, setBarcodePending] = useState<OFFProduct | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  // AI
  const [aiFood, setAiFood] = useState("");
  const [aiCalculating, setAiCalculating] = useState(false);
  const [aiResult, setAiResult] = useState<{ calories: number; protein_g: number; fat_g: number; carbs_g: number } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  async function handleBarcodeLookup() {
    const code = barcodeInput.trim();
    if (!code) return;
    setBarcodeNotFound(false);
    setBarcodeLoading(true);
    try {
      const res = await fetchWithTimeout(`/api/foods/off-product?barcode=${encodeURIComponent(code)}`);
      if (res.ok) {
        const data = (await res.json()) as OFFProduct;
        setBarcodePending(data);
        setBarcodeInput("");
      } else {
        setBarcodeNotFound(true);
      }
    } catch {
      setBarcodeNotFound(true);
    } finally {
      setBarcodeLoading(false);
    }
  }

  async function handleBarcodeScanned(barcode: string) {
    setBarcodeLoading(true);
    setBarcodeNotFound(false);
    try {
      const res = await fetchWithTimeout(`/api/foods/off-product?barcode=${encodeURIComponent(barcode)}`);
      if (res.ok) {
        const data = (await res.json()) as OFFProduct;
        setBarcodePending(data);
        setShowCamera(false);
      } else {
        setBarcodeNotFound(true);
      }
    } catch {
      setBarcodeNotFound(true);
    } finally {
      setBarcodeLoading(false);
    }
  }

  async function addBarcodeProduct(product: OFFProduct) {
    const saveRes = await fetchWithTimeout("/api/foods/save-from-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcode: product.barcode }),
    });
    if (!saveRes.ok) {
      setError("Failed to save food");
      return;
    }
    const { id } = (await saveRes.json()) as { id: number };
    setItems((prev) => [...prev, { food_id: id, food_name: product.name, amount: 1 }]);
    setBarcodePending(null);
  }

  async function handleAiCalculate() {
    const food = aiFood.trim();
    if (!food) {
      setAiError("Enter a food");
      return;
    }
    setAiError(null);
    setAiResult(null);
    setAiCalculating(true);
    try {
      const res = await fetch("/api/ai/calculate-macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ food, portionValue: 1, portionUnit: "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError((data.error as string) ?? "Failed to get macros");
        return;
      }
      setAiResult({
        calories: Number(data.calories) || 0,
        protein_g: Number(data.protein_g) || 0,
        fat_g: Number(data.fat_g) || 0,
        carbs_g: Number(data.carbs_g) || 0,
      });
    } finally {
      setAiCalculating(false);
    }
  }

  async function addAiResult() {
    if (!aiResult) return;
    const foodName = aiFood.trim() || "AI food";
    const createRes = await fetchWithTimeout("/api/foods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: foodName,
        calories: aiResult.calories,
        protein_g: aiResult.protein_g,
        fat_g: aiResult.fat_g,
        carbs_g: aiResult.carbs_g,
        serving_description: foodName,
        source: "gemini",
      }),
    });
    if (!createRes.ok) {
      setError("Failed to create food");
      return;
    }
    const { id } = (await createRes.json()) as { id: number };
    setItems((prev) => [...prev, { food_id: id, food_name: foodName, amount: 1 }]);
    setAiResult(null);
    setAiFood("");
  }

  async function handleSave() {
    const n = name.trim();
    if (!n) {
      setError("Name is required");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one food");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (mode === "add") {
        const res = await fetch("/api/member/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: n, items: items.map((i) => ({ food_id: i.food_id, amount: i.amount })) }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError((err as { error?: string }).error ?? "Failed to create");
          return;
        }
      } else if (initial) {
        const res = await fetch(`/api/member/favorites/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: n, items: items.map((i) => ({ food_id: i.food_id, amount: i.amount })) }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError((err as { error?: string }).error ?? "Failed to update");
          return;
        }
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-stone-200 flex justify-between items-center">
          <h2 className="font-semibold text-stone-800">{mode === "add" ? "Add Favorite" : "Edit Favorite"}</h2>
          <button type="button" onClick={onClose} className="p-1 text-stone-500 hover:bg-stone-100 rounded">✕</button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Morning smoothie"
              className="w-full px-3 py-2 rounded-lg border border-stone-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Foods</label>
            {items.length > 0 && (
              <ul className="mb-2 space-y-1">
                {items.map((item, idx) => (
                  <li key={idx} className="flex items-center justify-between px-3 py-1.5 rounded bg-stone-50 text-sm">
                    <span>{item.food_name} × {item.amount}</span>
                    <button type="button" onClick={() => removeItem(idx)} className="text-red-600 hover:underline text-xs">Remove</button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-stone-500 mb-2">Add foods with barcode or AI:</p>

            {/* Barcode */}
            <div className="mb-3 p-3 rounded-lg border border-stone-200 bg-stone-50/50">
              <p className="text-xs font-medium text-stone-600 mb-1">Barcode</p>
              {showCamera ? (
                <Suspense fallback={<div className="py-4 text-center text-stone-500 text-sm">Loading camera…</div>}>
                  <CameraBarcodeScanner onScan={handleBarcodeScanned} onClose={() => setShowCamera(false)} />
                </Suspense>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowCamera(true)} className="px-3 py-1.5 rounded bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">📷 Scan</button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={barcodeInput}
                    onChange={(e) => { setBarcodeInput(e.target.value); setBarcodeNotFound(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleBarcodeLookup(); }}
                    placeholder="Or type barcode"
                    className="flex-1 px-2 py-1.5 rounded border border-stone-200 text-sm"
                  />
                  <button type="button" onClick={handleBarcodeLookup} disabled={barcodeLoading || !barcodeInput.trim()} className="px-3 py-1.5 rounded bg-stone-700 text-white text-sm disabled:opacity-50">Look up</button>
                </div>
              )}
              {barcodeNotFound && <p className="text-amber-600 text-xs mt-1">Not found. Try AI lookup.</p>}
              {barcodePending && (
                <div className="mt-2 p-2 rounded bg-emerald-50 border border-emerald-200">
                  <p className="text-sm font-medium text-emerald-800">{barcodePending.name}</p>
                  <p className="text-xs text-stone-500">{barcodePending.calories ?? "?"} cal · P {barcodePending.protein_g ?? "?"}g · F {barcodePending.fat_g ?? "?"}g · C {barcodePending.carbs_g ?? "?"}g</p>
                  <button type="button" onClick={() => addBarcodeProduct(barcodePending)} className="mt-1 px-2 py-1 rounded bg-brand-600 text-white text-xs font-medium hover:bg-brand-700">Add to favorite</button>
                  <button type="button" onClick={() => setBarcodePending(null)} className="ml-1 px-2 py-1 rounded border border-stone-200 text-stone-600 text-xs">Cancel</button>
                </div>
              )}
            </div>

            {/* AI */}
            <div className="p-3 rounded-lg border border-stone-200 bg-stone-50/50">
              <p className="text-xs font-medium text-stone-600 mb-1">AI lookup</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiFood}
                  onChange={(e) => { setAiFood(e.target.value); setAiError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAiCalculate(); } }}
                  placeholder="e.g. musashi high protein bar"
                  className="flex-1 px-2 py-1.5 rounded border border-stone-200 text-sm"
                />
                <button type="button" onClick={handleAiCalculate} disabled={aiCalculating} className="px-3 py-1.5 rounded bg-stone-700 text-white text-sm disabled:opacity-50">{aiCalculating ? "…" : "Calculate"}</button>
              </div>
              {aiError && <p className="text-amber-600 text-xs mt-1">{aiError}</p>}
              {aiResult && (
                <div className="mt-2 p-2 rounded bg-stone-100">
                  <p className="text-xs text-stone-600">{aiResult.calories} cal · P {aiResult.protein_g}g · F {aiResult.fat_g}g · C {aiResult.carbs_g}g</p>
                  <button type="button" onClick={addAiResult} className="mt-1 px-2 py-1 rounded bg-brand-600 text-white text-xs font-medium hover:bg-brand-700">Add to favorite</button>
                  <button type="button" onClick={() => { setAiResult(null); setAiFood(""); }} className="ml-1 px-2 py-1 rounded border border-stone-200 text-stone-600 text-xs">Cancel</button>
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-amber-600 text-sm">{error}</p>}
        </div>
        <div className="p-4 border-t border-stone-200 flex gap-2">
          <button type="button" onClick={handleSave} disabled={saving || !name.trim() || items.length === 0} className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
