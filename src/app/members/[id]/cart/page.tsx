"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

type CartItem = {
  id: number;
  product_type: string;
  product_id: number;
  quantity: number;
  name: string;
  price: string;
};

type Plan = { id: number; plan_name: string; price: string };
type Session = { id: number; session_name: string; price: string };
type ClassRow = { id: number; class_name: string; price: string };
type ClassPack = { id: number; name: string; price: string; credits: number };
type PTPack = { id: number; name: string; price: string; credits: number; duration_minutes: number };

export default function MemberCartPage() {
  const params = useParams();
  const id = params.id as string;
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classPacks, setClassPacks] = useState<ClassPack[]>([]);
  const [ptPacks, setPtPacks] = useState<PTPack[]>([]);
  const [addMode, setAddMode] = useState<"membership_plan" | "pt_session" | "class" | "class_pack" | "pt_pack" | null>(null);
  const [saveCardForFuture, setSaveCardForFuture] = useState<boolean | null>(null);
  const [hasSavedCard, setHasSavedCard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/members/${id}/cart-data`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMemberId(data.memberId);
        setMemberName(data.memberName ?? "Member");
        setItems(data.items ?? []);
        setPlans(data.plans ?? []);
        setSessions(data.sessions ?? []);
        setClasses(data.classes ?? []);
        setClassPacks(data.classPacks ?? []);
        setPtPacks(data.ptPackProducts ?? []);
        setHasSavedCard(Boolean(data.has_saved_card));
        if (data.has_saved_card) setSaveCardForFuture(false);
      })
      .catch(() => {
        if (!cancelled) setMemberId(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);


  async function addToCart(product_type: "membership_plan" | "pt_session" | "class" | "class_pack" | "pt_pack", product_id: number) {
    if (!memberId) return;
    const res = await fetch("/api/cart/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId, product_type, product_id, quantity: 1 }),
    });
    if (res.ok) {
      const data = await fetch(`/api/cart?member_id=${encodeURIComponent(memberId)}`).then((r) => r.json());
      setItems(data.items ?? []);
      setAddMode(null);
    }
  }

  async function removeItem(itemId: number) {
    await fetch(`/api/cart/items/${itemId}`, { method: "DELETE" });
    if (memberId) {
      const data = await fetch(`/api/cart?member_id=${encodeURIComponent(memberId)}`).then((r) => r.json());
      setItems(data.items ?? []);
    }
  }

  async function goToStripeCheckout() {
    if (!memberId || items.length === 0) return;
    if (!hasSavedCard && saveCardForFuture === null) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/cart/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, save_card_for_future: saveCardForFuture === true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start checkout");
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("No checkout URL returned");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCheckoutLoading(false);
    }
  }

  const total = items.reduce((sum, it) => {
    const p = parseFloat(String(it.price).replace(/[^0-9.-]/g, "")) || 0;
    return sum + (Number.isNaN(p) ? 0 : p) * it.quantity;
  }, 0);

  if (loading && !memberId) return <div className="p-12 text-center text-stone-500">Loading…</div>;
  if (!memberId) return <div className="p-12 text-center text-red-600">Member not found.</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <Link href={`/members/${id}`} className="text-stone-500 hover:text-stone-700 text-sm mb-4 inline-block">← Back to member</Link>
      <h1 className="text-2xl font-bold text-stone-800 mb-1">Cart for {memberName}</h1>
      <p className="text-stone-500 text-sm mb-6">Add membership, class, or PT session. Click Pay with Stripe to complete payment; when payment succeeds, we’ll activate the membership and notify Kisi for door access.</p>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAddMode(addMode === "membership_plan" ? null : "membership_plan")}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
        >
          Add membership
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "pt_session" ? null : "pt_session")}
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Add PT session
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "class" ? null : "class")}
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Add class
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "class_pack" ? null : "class_pack")}
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Add class pack
        </button>
        <button
          type="button"
          onClick={() => setAddMode(addMode === "pt_pack" ? null : "pt_pack")}
          className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 font-medium"
        >
          Add PT pack
        </button>
      </div>

      {addMode === "membership_plan" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a plan</p>
          <ul className="space-y-1">
            {plans.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addToCart("membership_plan", p.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {p.plan_name} — {formatPrice(p.price)}
                </button>
              </li>
            ))}
            {plans.length === 0 && <li className="text-stone-600 text-sm">No plans. Add some in Membership plans.</li>}
          </ul>
        </div>
      )}
      {addMode === "pt_session" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a PT session</p>
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => addToCart("pt_session", s.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {s.session_name} — {formatPrice(s.price)}
                </button>
              </li>
            ))}
            {sessions.length === 0 && <li className="text-stone-600 text-sm">No PT sessions.</li>}
          </ul>
        </div>
      )}
      {addMode === "class" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a class</p>
          <ul className="space-y-1">
            {classes.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => addToCart("class", c.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {c.class_name} — {formatPrice(c.price)}
                </button>
              </li>
            ))}
            {classes.length === 0 && <li className="text-stone-600 text-sm">No classes.</li>}
          </ul>
        </div>
      )}
      {addMode === "class_pack" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a class pack</p>
          <ul className="space-y-1">
            {classPacks.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addToCart("class_pack", p.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {p.name} — {p.credits} credits · {formatPrice(p.price)}
                </button>
              </li>
            ))}
            {classPacks.length === 0 && <li className="text-stone-600 text-sm">No class packs. Add some in Class packs.</li>}
          </ul>
        </div>
      )}
      {addMode === "pt_pack" && (
        <div className="mb-6 p-4 rounded-xl border border-stone-300 bg-stone-200">
          <p className="text-sm font-medium mb-2" style={{ color: "#5abd78" }}>Select a PT pack</p>
          <ul className="space-y-1">
            {ptPacks.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addToCart("pt_pack", p.id)} className="hover:underline font-medium" style={{ color: "#5abd78" }}>
                  {p.name} — {p.credits}×{p.duration_minutes} min · {formatPrice(p.price)}
                </button>
              </li>
            ))}
            {ptPacks.length === 0 && <li className="text-stone-600 text-sm">No PT packs. Add some in PT packs.</li>}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden mb-6">
        <div className="p-4 border-b border-stone-100 font-medium text-stone-800">Cart</div>
        {items.length === 0 ? (
          <p className="p-6 text-stone-500 text-sm">Cart is empty. Add a membership, class, or PT session above.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((it) => (
              <li key={it.id} className="p-4 flex justify-between items-center">
                <span>{it.name} × {it.quantity} — {formatPrice(it.price)}</span>
                <button type="button" onClick={() => removeItem(it.id)} className="text-red-600 hover:text-red-700 p-1 rounded" title="Remove" aria-label="Remove item">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <div className="p-4 border-t border-stone-100 flex justify-between items-center">
            <span className="font-medium">Total</span>
            <span>{formatPrice(total)}</span>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <>
          {!hasSavedCard && (
            <div className="mb-6 p-4 rounded-xl border border-stone-200 bg-white">
              <p className="text-sm font-medium text-stone-800 mb-2">Use this card for future payments?</p>
              <p className="text-stone-500 text-xs mb-3">We will use the card on file to auto-charge your membership on the next billing date. You must choose one before paying.</p>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="save_card"
                    checked={saveCardForFuture === true}
                    onChange={() => setSaveCardForFuture(true)}
                    className="text-brand-600"
                  />
                  <span className="text-sm font-medium">Yes — save for renewals</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="save_card"
                    checked={saveCardForFuture === false}
                    onChange={() => setSaveCardForFuture(false)}
                    className="text-brand-600"
                  />
                  <span className="text-sm font-medium">No — one-time only</span>
                </label>
              </div>
              {saveCardForFuture === null && (
                <p className="text-brand-600 text-xs mt-2">Please select Yes or No above.</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              onClick={goToStripeCheckout}
              disabled={checkoutLoading || (!hasSavedCard && saveCardForFuture === null)}
              className="px-6 py-3 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {checkoutLoading ? "Redirecting to Stripe…" : "Pay with Stripe"}
            </button>
            <p className="text-stone-500 text-sm self-center">
              You will complete payment on Stripe; then we will activate the membership and notify Kisi for door access.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
