"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type DemoVideo = {
  video_id: string;
  url: string;
  title: string;
  channel_title: string;
  tier: "A" | "B";
};

type Payload = {
  videos: DemoVideo[];
  status: "ready" | "pending" | "unavailable";
  refreshing?: boolean;
  message?: string;
};

const POLL_MS = 1500;
const MAX_POLLS = 24;

export default function ExerciseDemoVideos({ exerciseId }: { exerciseId: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const polls = useRef(0);

  useEffect(() => {
    polls.current = 0;
    setData(null);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const res = await fetch(`/api/exercises/${exerciseId}/demo-videos`);
        const json = (await res.json().catch(() => null)) as Payload | null;
        if (cancelled || !json) return;
        setData(json);
        if (
          json.status === "pending" &&
          polls.current < MAX_POLLS &&
          (json.videos?.length ?? 0) === 0
        ) {
          polls.current += 1;
          timer = setTimeout(() => void load(), POLL_MS);
        }
      } catch {
        if (!cancelled) setData({ videos: [], status: "unavailable" });
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [exerciseId]);

  if (!data) {
    return (
      <DemoVideosSection
        title="How-to videos"
        body={<p className="text-sm text-stone-400">Loading suggested videos…</p>}
      />
    );
  }

  if (data.status === "unavailable") {
    return null;
  }

  const pending = data.status === "pending" && data.videos.length === 0;

  return (
    <DemoVideosSection
      title="How-to videos"
      body={
        <>
          <p className="text-xs text-stone-500 mb-3 leading-relaxed">
            These open on YouTube (third-party). They are not Fox coaching or medical advice. Stop if
            anything hurts and ask a trainer.
          </p>
          {pending ? (
            <p className="text-sm text-stone-400">Finding form videos… usually a few seconds.</p>
          ) : data.videos.length === 0 ? (
            <p className="text-sm text-stone-500">No vetted videos found for this exercise yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.videos.map((v) => (
                <li key={v.video_id}>
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg border border-stone-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/50 transition-colors"
                  >
                    <span className="text-sm font-medium text-brand-700 line-clamp-2">{v.title}</span>
                    {v.channel_title ? (
                      <span className="text-xs text-stone-500 block mt-0.5">{v.channel_title}</span>
                    ) : null}
                    <span className="text-xs text-stone-400 mt-1 inline-block">Open on YouTube ↗</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      }
    />
  );
}

function DemoVideosSection({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="border-t border-stone-100 pt-4">
      <h3 className="text-sm font-semibold text-stone-700 mb-2">{title}</h3>
      {body}
    </div>
  );
}
