import { Suspense } from "react";
import InStoreMarketingTVDisplay from "@/components/admin/InStoreMarketingTVDisplay";

export const metadata = {
  title: "In-Store Marketing TV | Pono Fit Co.",
};

export const dynamic = "force-dynamic";

/** Public landscape marketing slideshow for the lobby TV — no login required. */
export default function InStoreMarketingTvPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-black text-[#9ef6b2]">
          Loading…
        </div>
      }
    >
      <InStoreMarketingTVDisplay />
    </Suspense>
  );
}
