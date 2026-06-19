import { Suspense } from "react";
import TheBoardTVDisplay from "@/components/admin/TheBoardTVDisplay";

export const metadata = {
  title: "The Board | Pono Fit Co.",
};

export const dynamic = "force-dynamic";

/**
 * Hidden, no-login TV display for the always-on gym screen.
 * Requires a valid `?token=` matching `BOARD_TV_TOKEN`. Not linked anywhere in the app.
 */
export default async function PublicBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";

  if (!token) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-950 p-6 text-center text-stone-400">
        <p>Missing display token.</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-stone-950 text-[#9ef6b2]">
          Loading…
        </div>
      }
    >
      <TheBoardTVDisplay token={token} />
    </Suspense>
  );
}
