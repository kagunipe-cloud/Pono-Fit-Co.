"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

export function BackLink() {
  const params = useSearchParams();
  const token = params.get("token");
  const href = token ? `/sign-waiver?token=${encodeURIComponent(token)}` : "/";
  return (
    <Link href={href} className="text-stone-500 hover:text-stone-700 text-sm mb-6 inline-block">
      ← Back
    </Link>
  );
}
