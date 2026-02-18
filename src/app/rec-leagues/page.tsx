"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RecLeaguesHubPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/rec-leagues/teams");
  }, [router]);
  return (
    <div className="max-w-2xl">
      <p className="text-stone-500 text-sm">Redirecting to Teams…</p>
    </div>
  );
}
