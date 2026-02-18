"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/format";

type Pack = { id: number; name: string; price: string; credits: number };

export default function MemberClassPacksPage() {
  const router = useRouter();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/offerings/class-packs").then((r) => r.json()),
    ])
      .then(([me, list]) => {
        if (!me?.member_id) {
          router.replace("/login");
          return;
        }
        setMemberId(me.member_id);
        setPacks(Array.isArray(list) ? list : []);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function addToCart(packId: number) {
    if (!memberId) return;
    setAddingId(packId);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, product_type: "class_pack", product_id: packId, quantity: 1 }),
      });
      if (res.ok) router.push("/member/cart");
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Could not add to cart");
      }
    } finally {
      setAddingId(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!memberId) return null;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Class Packs</h1>
      <p className="text-stone-600 mb-6">
        Buy class credits to book with one credit per class. Then use them on <Link href="/member/book-classes" className="text-brand-600 hover:underline">Book class</Link>.
      </p>
      <ul className="space-y-4">
        {packs.map((p) => (
          <li key={p.id} className="p-4 rounded-xl border border-stone-200 bg-white flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-stone-800">{p.name}</p>
              <p className="text-sm text-stone-500">{p.credits} credits · {formatPrice(p.price)}</p>
            </div>
            <button
              type="button"
              onClick={() => addToCart(p.id)}
              disabled={addingId !== null}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {addingId === p.id ? "Adding…" : "Add to cart"}
            </button>
          </li>
        ))}
      </ul>
      {packs.length === 0 && <p className="text-stone-500">No class packs available yet. Ask staff to add some.</p>}
      <p className="mt-6">
        <Link href="/member/book-classes" className="text-brand-600 hover:underline">Book a class →</Link>
      </p>
    </div>
  );
}
