"use client";

import { useState } from "react";

const BUY_PATH_MAP: Record<string, string> = {
  membership: "membership",
  "pt-session": "pt-session",
  "class-pack": "class-pack",
  "pt-pack": "pt-pack",
  class: "class",
};

type Props = {
  productType: keyof typeof BUY_PATH_MAP;
  productId: number;
  className?: string;
};

export function CopyBuyLinkButton({ productType, productId, className = "" }: Props) {
  const [copied, setCopied] = useState(false);
  const path = BUY_PATH_MAP[productType];
  if (!path) return null;

  const url = typeof window !== "undefined" ? `${window.location.origin}/buy/${path}/${productId}` : `/buy/${path}/${productId}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`text-brand-600 hover:underline text-sm ${className}`}
      title="Copy public buy link"
    >
      {copied ? "Copied!" : "Copy buy link"}
    </button>
  );
}
