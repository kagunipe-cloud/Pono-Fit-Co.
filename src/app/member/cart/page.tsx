"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function MemberCartPage() {
  const router = useRouter();
  const [memberId, setMemberId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/member-me")
      .then((res) => {
        if (!res.ok) {
          router.replace("/login");
          return null;
        }
        return res.json();
      })
      .then((me) => {
        if (me?.member_id) {
          setMemberId(me.member_id);
          router.replace(`/members/${me.member_id}/cart`);
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  return <div className="p-8 text-center text-stone-500">Redirecting to cart…</div>;
}
