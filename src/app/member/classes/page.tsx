"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPrice, toTitleCase } from "@/lib/format";

type ClassType = { class_name: string; instructor: string | null; price: string | null; description: string | null; image_url: string | null };
type ClassPack = { id: number; name: string; price: string; credits: number };
type ClassTypesResponse = { types: ClassType[]; classPacks: ClassPack[]; singleCreditPack: { id: number; price: string } | null };

export default function MemberClassesPage() {
  const router = useRouter();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [classTypes, setClassTypes] = useState<ClassType[]>([]);
  const [classPacks, setClassPacks] = useState<ClassPack[]>([]);
  const [singleCreditPack, setSingleCreditPack] = useState<{ id: number; price: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addingSingleCredit, setAddingSingleCredit] = useState(false);

  const multiCreditPacks = classPacks.filter((p) => p.credits > 1);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/member-me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/offerings/class-types").then((r) => r.json()),
    ])
      .then(([me, data]: [unknown, ClassTypesResponse]) => {
        if (!me?.member_id) {
          router.replace("/login");
          return;
        }
        setMemberId(me.member_id);
        setClassTypes(Array.isArray(data?.types) ? data.types : []);
        setClassPacks(Array.isArray(data?.classPacks) ? data.classPacks : []);
        setSingleCreditPack(data?.singleCreditPack ?? null);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function addPackToCart(pack: ClassPack) {
    if (!memberId) return;
    setAddingId(pack.id);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, product_type: "class_pack", product_id: pack.id, quantity: 1 }),
      });
      if (res.ok) router.push("/member/cart");
    } finally {
      setAddingId(null);
    }
  }

  async function addSingleCreditToCart() {
    if (!memberId || !singleCreditPack) return;
    setAddingSingleCredit(true);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, product_type: "class_pack", product_id: singleCreditPack.id, quantity: 1 }),
      });
      if (res.ok) router.push("/member/cart");
    } finally {
      setAddingSingleCredit(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!memberId) return null;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Browse Classes</h1>
      <p className="text-stone-500 text-sm mb-6">
        Browse class types below. Pick a date and time on the Schedule when you’re ready to book, or buy one credit and schedule later.
      </p>
      {multiCreditPacks.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-stone-800 mb-0.5">Class Packs</h2>
          <p className="text-sm text-stone-500 mb-4">Bulk Discounts</p>
          <div className="space-y-4">
          {multiCreditPacks.map((pack) => (
            <div
              key={pack.id}
              className="p-4 rounded-xl border border-brand-200 bg-brand-50 flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <p className="font-medium text-stone-800">{pack.name}</p>
                <p className="text-sm text-stone-500">
                  Get {pack.credits} class credit{pack.credits !== 1 ? "s" : ""}. Book a time on the schedule or call when you’re ready.
                </p>
              </div>
              <button
                type="button"
                onClick={() => addPackToCart(pack)}
                disabled={addingId !== null}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {addingId === pack.id ? "Adding…" : `${formatPrice(pack.price)} — Add to Cart`}
              </button>
            </div>
          ))}
          </div>
        </div>
      )}
      {classTypes.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-stone-800 mb-0.5">Current Classes</h2>
          <p className="text-sm text-stone-500 mb-4">View on Schedule to Book</p>
        </>
      )}
      <ul className="space-y-4">
        {classTypes.map((c, i) => (
          <li
            key={`${c.class_name}-${c.instructor ?? ""}-${i}`}
            className="p-4 rounded-xl border border-stone-200 bg-white flex flex-wrap gap-4"
          >
            {c.image_url && (
              <div className="shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-stone-100">
                <img src={c.image_url} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-stone-800">{toTitleCase(c.class_name)}</p>
              <p className="text-sm text-stone-500 mb-1">
                {c.instructor ? toTitleCase(c.instructor) : "—"} · {formatPrice(c.price)}
              </p>
              {c.description && <p className="text-sm text-stone-600">{c.description}</p>}
            </div>
            <div className="w-full sm:w-auto shrink-0 flex flex-wrap gap-2">
              {singleCreditPack && (
                <button
                  type="button"
                  onClick={addSingleCreditToCart}
                  disabled={addingSingleCredit}
                  className="px-4 py-2 rounded-lg border border-[#5abd78] text-sm font-medium hover:bg-brand-50 disabled:opacity-50"
                  style={{ color: "#5abd78" }}
                >
                  {addingSingleCredit ? "Adding…" : "Buy now and schedule later"}
                </button>
              )}
              <Link
                href="/schedule"
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 inline-block"
              >
                View on Schedule
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {classTypes.length === 0 && multiCreditPacks.length === 0 && <p className="text-stone-500">No class types available yet.</p>}
      <p className="mt-6">
        <Link href="/schedule" className="text-brand-600 hover:underline">Open Schedule →</Link>
        {" · "}
        <Link href="/member/book-classes" className="text-brand-600 hover:underline">Book With Credit</Link>
        {singleCreditPack && (
          <>
            {" · "}
            <Link href="/member/class-packs" className="text-brand-600 hover:underline">More Class Packs</Link>
          </>
        )}
      </p>
    </div>
  );
}
