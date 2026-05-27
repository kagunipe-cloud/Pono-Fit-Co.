"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WeeklyGoalsEditor from "@/components/member/WeeklyGoalsEditor";

export default function MemberWeeklyGoalsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/member/me")
      .then((res) => {
        if (res.status === 401) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then((data) => setAuthorized(Boolean(data?.member)))
      .catch(() => setAuthorized(false))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>;
  if (!authorized) return <div className="p-8 text-center text-stone-500">Unable to load. Try logging in again.</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Weekly Goals</h1>
      <WeeklyGoalsEditor />
    </div>
  );
}
