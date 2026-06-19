import { Suspense } from "react";
import TheBoardTVDisplay from "@/components/admin/TheBoardTVDisplay";

export const metadata = {
  title: "The Board | Pono Fit Co.",
};

export const dynamic = "force-dynamic";

/**
 * Hidden, no-login TV display with the token in the path for easy bookmarking:
 * `/board/<token>`. Requires a valid token matching `BOARD_TV_TOKEN`.
 */
export default async function PublicBoardTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const token = (await params).token ?? "";

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
