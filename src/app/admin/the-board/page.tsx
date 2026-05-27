"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TheBoardTabs, type TheBoardTab } from "@/components/admin/TheBoardTabs";
import GoalBoardDisplay from "@/components/admin/GoalBoardDisplay";
import GymRecordsBoard from "@/components/admin/GymRecordsBoard";

function parseTab(raw: string | null): TheBoardTab {
  return raw === "records" ? "records" : "goals";
}

export default function TheBoardPage() {
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/reports" className="mb-4 inline-block text-sm text-stone-500 hover:text-stone-700">
        ← Reports
      </Link>

      <div className="mb-2">
        <h1 className="text-2xl font-bold text-stone-800">The Board</h1>
        <p className="text-sm text-stone-600 mt-1">Admin displays for weekly goals and gym records.</p>
      </div>

      <TheBoardTabs active={tab} />

      {tab === "records" ? <GymRecordsBoard /> : <GoalBoardDisplay />}
    </div>
  );
}
