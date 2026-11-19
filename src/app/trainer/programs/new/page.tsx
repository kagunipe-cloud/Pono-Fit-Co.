"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function NewTrainerProgramPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [forSale, setForSale] = useState(false);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    try {
      const price_cents = forSale && price.trim() ? Math.round(parseFloat(price) * 100) : null;
      const res = await fetch("/api/trainer/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          is_for_sale: forSale,
          price_cents,
          published: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create");
        return;
      }
      router.push(`/trainer/programs/${data.program?.id ?? ""}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-4">New program</h1>
      <label className="block text-sm font-medium text-stone-700 mb-1">Title</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full mb-3 px-3 py-2 rounded-lg border border-stone-200"
        placeholder="e.g. 8-Week Strength Block"
      />
      <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className="w-full mb-3 px-3 py-2 rounded-lg border border-stone-200 text-sm"
      />
      <label className="flex items-center gap-2 text-sm text-stone-700 mb-2">
        <input type="checkbox" checked={forSale} onChange={(e) => setForSale(e.target.checked)} />
        Offer for purchase (à la carte)
      </label>
      {forSale && (
        <input
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Price USD"
          className="w-full mb-4 px-3 py-2 rounded-lg border border-stone-200"
        />
      )}
      {error && <p className="text-sm text-amber-800 mb-2">{error}</p>}
      <button
        type="button"
        disabled={saving}
        onClick={() => void create()}
        className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? "Creating…" : "Create & open editor"}
      </button>
      <p className="mt-6">
        <Link href="/trainer/programs" className="text-sm text-brand-600 hover:underline">
          ← Cancel
        </Link>
      </p>
    </div>
  );
}