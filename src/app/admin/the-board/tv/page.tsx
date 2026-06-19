import { Suspense } from "react";
import TheBoardTVDisplay from "@/components/admin/TheBoardTVDisplay";

export const metadata = {
  title: "The Board TV | Pono Fit Co.",
};

export default function TheBoardTVPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-stone-950 text-[#9ef6b2]">
          Loading…
        </div>
      }
    >
      <TheBoardTVDisplay />
    </Suspense>
  );
}
