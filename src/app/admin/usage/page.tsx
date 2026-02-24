"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTimeInAppTz } from "@/lib/app-timezone";

type DoorEvent = {
  id: number;
  uuid: string;
  member_id: string | null;
  member_name: string | null;
  kisi_actor_id: number | null;
  kisi_actor_name: string | null;
  lock_id: number | null;
  lock_name: string | null;
  success: number;
  happened_at: string;
  created_at: string;
};

type AppEvent = {
  id: number;
  member_id: string;
  member_name: string | null;
  event_type: string;
  path: string | null;
  created_at: string;
};

type UsageData = { door: DoorEvent[]; app: AppEvent[] } | null;

function formatDateTimeHawaii(s: string) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return formatDateTimeInAppTz(d);
}

export default function AdminUsagePage() {
  const router = useRouter();
  const [data, setData] = useState<UsageData>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<string>("30");
  const [activeTab, setActiveTab] = useState<"door" | "app">("door");

  useEffect(() => {
    const params = new URLSearchParams();
    const d = parseInt(days, 10);
    if (d > 0) params.set("days", String(d));
    params.set("limit", "500");
    fetch(`/api/admin/usage?${params}`)
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((json) => {
        if (json?.door && json?.app) setData({ door: json.door, app: json.app });
        else setData({ door: [], app: [] });
      })
      .catch(() => setData({ door: [], app: [] }))
      .finally(() => setLoading(false));
  }, [router, days]);

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm mb-2 inline-block">
          ← Back to home
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">Usage tracking</h1>
        <p className="text-stone-500 mt-1">
          Door unlocks (Kisi webhooks) and app usage (member page views). Admin only.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm text-stone-600">Last</label>
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm"
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="">All time</option>
          </select>
        </div>
      </header>

      {loading ? (
        <p className="text-stone-500">Loading…</p>
      ) : !data ? (
        <p className="text-stone-500">Failed to load usage data.</p>
      ) : (
        <>
          <div className="flex gap-2 mb-4 border-b border-stone-200">
            <button
              type="button"
              onClick={() => setActiveTab("door")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "door" ? "border-brand-600 text-brand-700" : "border-transparent text-stone-500 hover:text-stone-700"
              }`}
            >
              Door access ({data.door.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("app")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "app" ? "border-brand-600 text-brand-700" : "border-transparent text-stone-500 hover:text-stone-700"
              }`}
            >
              App usage ({data.app.length})
            </button>
          </div>

          {activeTab === "door" && (
            <section className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <h2 className="sr-only">Door access events</h2>
              {data.door.length === 0 ? (
                <p className="p-6 text-stone-500">No door events in this period. Configure the Kisi webhook to start recording.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-stone-50 text-stone-500 font-medium">
                        <th className="py-2.5 px-3">Time</th>
                        <th className="py-2.5 px-3">Member</th>
                        <th className="py-2.5 px-3">Lock</th>
                        <th className="py-2.5 px-3">Success</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.door.map((e) => (
                        <tr key={e.id} className="border-t border-stone-100">
                          <td className="py-2 px-3 whitespace-nowrap">{formatDateTimeHawaii(e.happened_at)}</td>
                          <td className="py-2 px-3">
                            {e.member_id ? (
                              <Link href={`/members/${e.member_id}`} className="text-brand-600 hover:underline">
                                {(e.member_name && e.member_name.trim()) || e.member_id}
                              </Link>
                            ) : (
                              <span className="text-stone-400">{e.kisi_actor_name ?? (e.kisi_actor_id != null ? `Kisi #${e.kisi_actor_id}` : "—")}</span>
                            )}
                          </td>
                          <td className="py-2 px-3">{e.lock_name ?? e.lock_id ?? "—"}</td>
                          <td className="py-2 px-3">{e.success ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === "app" && (
            <section className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <h2 className="sr-only">App usage events</h2>
              {data.app.length === 0 ? (
                <p className="p-6 text-stone-500">No app usage in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-stone-50 text-stone-500 font-medium">
                        <th className="py-2.5 px-3">Time</th>
                        <th className="py-2.5 px-3">Member</th>
                        <th className="py-2.5 px-3">Event</th>
                        <th className="py-2.5 px-3">Path</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.app.map((e) => (
                        <tr key={e.id} className="border-t border-stone-100">
                          <td className="py-2 px-3 whitespace-nowrap">{formatDateTimeHawaii(e.created_at)}</td>
                          <td className="py-2 px-3">
                            <Link href={`/members/${e.member_id}`} className="text-brand-600 hover:underline">
                              {(e.member_name && e.member_name.trim()) || e.member_id}
                            </Link>
                          </td>
                          <td className="py-2 px-3">{e.event_type}</td>
                          <td className="py-2 px-3 text-stone-600 font-mono text-xs max-w-xs truncate" title={e.path ?? undefined}>
                            {e.path ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
