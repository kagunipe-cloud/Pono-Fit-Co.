"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { formatPrice, toTitleCase } from "@/lib/format";
import { BRAND } from "@/lib/branding";
import { EMAIL_POLICY_MESSAGE } from "@/lib/email-policy";

type ProductInfo = {
  name: string;
  description: string | null;
  price: string;
  subtitle?: string;
};

const PRODUCT_TYPE_MAP: Record<string, { api: string; cartType: string; browsePath: string }> = {
  membership: { api: "membership-plans", cartType: "membership_plan", browsePath: "/member/memberships" },
  "day-pass": { api: "membership-plans", cartType: "membership_plan", browsePath: "/member/memberships" },
  "pt-session": { api: "pt-sessions", cartType: "pt_session", browsePath: "/member/pt-sessions" },
  "class-pack": { api: "class-packs", cartType: "class_pack", browsePath: "/member/class-packs" },
  "pt-pack": { api: "pt-pack-products", cartType: "pt_pack", browsePath: "/member/pt-packs" },
  class: { api: "classes", cartType: "class", browsePath: "/member/classes" },
};

export default function BuyProductPage() {
  const params = useParams();
  const pathname = usePathname();
  const productType = (params?.productType as string) ?? "";
  const productId = (params?.productId as string) ?? "";
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const config = PRODUCT_TYPE_MAP[productType];

  useEffect(() => {
    if (!config || !productId) {
      setError("Invalid product link.");
      setLoading(false);
      return;
    }
    const id = parseInt(productId, 10);
    if (Number.isNaN(id)) {
      setError("Invalid product ID.");
      setLoading(false);
      return;
    }
    fetch(`/api/offerings/${config.api}/${id}`)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 404) throw new Error("Product not found");
          throw new Error("Failed to load");
        }
        return r.json();
      })
      .then((data: Record<string, unknown>) => {
        if (productType === "membership" || productType === "day-pass") {
          setProduct({
            name: toTitleCase(String(data.plan_name ?? data.product_id ?? "Membership")),
            description: (data.description as string)?.trim() || null,
            price: String(data.price ?? ""),
            subtitle: [data.length, data.unit].filter(Boolean).join(" ") || undefined,
          });
        } else if (productType === "pt-session") {
          const duration = data.duration_minutes ?? data.session_duration;
          const durStr = duration ? `${duration} min` : "";
          setProduct({
            name: toTitleCase(String(data.session_name ?? "PT Session")),
            description: (data.description as string)?.trim() || null,
            price: String(data.price ?? ""),
            subtitle: durStr ? `${durStr} session` : undefined,
          });
        } else if (productType === "class-pack") {
          const credits = data.credits ?? 0;
          setProduct({
            name: toTitleCase(String(data.name ?? "Class Pack")),
            description: null,
            price: String(data.price ?? ""),
            subtitle: credits ? `${credits} class credits` : undefined,
          });
        } else if (productType === "pt-pack") {
          const dur = data.duration_minutes ?? 60;
          const credits = data.credits ?? 0;
          setProduct({
            name: toTitleCase(String(data.name ?? "PT Pack")),
            description: null,
            price: String(data.price ?? ""),
            subtitle: credits ? `${credits}×${dur} min sessions` : `${dur} min sessions`,
          });
        } else if (productType === "class") {
          const instructor = data.instructor ? `with ${data.instructor}` : "";
          setProduct({
            name: toTitleCase(String(data.class_name ?? "Class")),
            description: (data.description as string)?.trim() || null,
            price: String(data.price ?? ""),
            subtitle: instructor || undefined,
          });
        } else {
          setError("Unknown product type.");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong"))
      .finally(() => setLoading(false));
  }, [productType, productId, config]);

  // Check if user is logged in (for "Add to cart" flow)
  useEffect(() => {
    if (!config || !product) return;
    fetch("/api/auth/member-me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => me?.member_id && setMemberId(me.member_id))
      .catch(() => {});
  }, [config, product]);

  async function addToCart() {
    if (!memberId || !config || !productId) return;
    const id = parseInt(productId, 10);
    if (Number.isNaN(id)) return;
    setAdding(true);
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, product_type: config.cartType, product_id: id, quantity: 1 }),
      });
      if (res.ok) {
        window.location.href = "/member/cart";
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Could not add to cart");
      }
    } finally {
      setAdding(false);
    }
  }

  /** After signup / waiver, land on browse page with optional ?plan= for single-product focus (membership & day-pass). */
  const browseRedirect =
    config &&
    (productType === "membership" || productType === "day-pass") &&
    productId &&
    !Number.isNaN(parseInt(productId, 10))
      ? `${config.browsePath}?plan=${encodeURIComponent(productId)}`
      : config?.browsePath ?? "/member";
  const signupUrl = `/signup?redirect=${encodeURIComponent(browseRedirect)}`;
  const loginUrl = `/login?next=${encodeURIComponent(pathname || `/buy/${productType}/${productId}`)}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <p className="text-red-600 mb-4">{error ?? "Product not found."}</p>
          <Link href="/" className="text-brand-600 hover:underline">
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-lg mx-auto p-6 pt-12">
        <div className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-brand-400 to-brand-600" />
          <div className="p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-stone-800">{product.name}</h1>
            {product.subtitle && (
              <p className="text-stone-500 text-sm mt-1">{product.subtitle}</p>
            )}
            {product.description && (
              <p className="text-stone-600 text-sm mt-4 leading-relaxed">{product.description}</p>
            )}
            <div className="mt-6 flex items-center justify-between py-4 border-t border-b border-stone-100">
              <span className="text-stone-500 text-sm font-medium">Price</span>
              <span className="text-xl font-bold text-stone-800">{formatPrice(product.price)}</span>
            </div>
            <p className="text-stone-500 text-sm mt-6">
              {memberId
                ? "Add this to your cart and complete your purchase in the app."
                : `Create a free account to add this to your cart and complete your purchase in the ${BRAND.name} app.`}
            </p>
            <p className="text-stone-600 text-xs leading-relaxed mt-3 p-3 rounded-lg bg-stone-50 border border-stone-100">
              {EMAIL_POLICY_MESSAGE}
            </p>
            {memberId ? (
              <button
                type="button"
                onClick={addToCart}
                disabled={adding}
                className="mt-6 flex items-center justify-center gap-2 w-full py-4 px-6 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add to cart"}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </button>
            ) : (
              <Link
                href={signupUrl}
                className="mt-6 flex items-center justify-center gap-2 w-full py-4 px-6 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition-colors"
              >
                Sign up to purchase
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            )}
          </div>
        </div>
        <p className="mt-6 text-center">
          <Link href={loginUrl} className="text-stone-500 hover:text-stone-700 text-sm">
            Already have an account? Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
