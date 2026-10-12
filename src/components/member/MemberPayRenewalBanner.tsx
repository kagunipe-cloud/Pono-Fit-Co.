"use client";

import Link from "next/link";

type Props = {
  title: string;
  description: string;
  paying: boolean;
  payMessage: string | null;
  onPay: () => void;
  className?: string;
};

export function MemberPayRenewalBanner({
  title,
  description,
  paying,
  payMessage,
  onPay,
  className = "mb-6",
}: Props) {
  return (
    <div className={`p-4 rounded-xl border border-red-300 bg-red-50 text-red-950 ${className}`}>
      <p className="font-semibold text-sm mb-1">{title}</p>
      <p className="text-sm text-red-900/95 mb-3">{description}</p>
      <button
        type="button"
        onClick={onPay}
        disabled={paying}
        className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-red-800 text-white text-sm font-medium hover:bg-red-900 disabled:opacity-50"
      >
        {paying ? "Processing…" : "Pay now"}
      </button>
      {payMessage && <p className="text-sm mt-3 text-red-900">{payMessage}</p>}
      <p className="text-xs mt-3 text-red-800/90">
        Card trouble?{" "}
        <Link href="/member/membership" className="font-medium underline hover:no-underline">
          Update payment method
        </Link>
      </p>
    </div>
  );
}
