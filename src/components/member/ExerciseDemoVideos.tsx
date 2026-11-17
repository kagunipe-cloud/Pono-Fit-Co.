"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type DemoVideo = {
  video_id: string;
  url: string;
  title: string;
  channel_title: string;
  tier: "A" | "B";
  format?: "short" | "full";
};

type Payload = {
  videos: DemoVideo[];
  shorts?: DemoVideo[];
  full_length?: DemoVideo[];
  status: "ready" | "pending" | "unavailable";
  refreshing?: boolean;
  message?: string;
};

const POLL_MS = 1500;
const MAX_POLLS = 24;

function partitionVideos(data: Payload): { shorts: DemoVideo[]; fullLength: DemoVideo[] } {
  if (Array.isArray(data.shorts) || Array.isArray(data.full_length)) {
    return {
      shorts: data.shorts ?? [],
      fullLength: data.full_length ?? [],
    };
  }
  const shorts: DemoVideo[] = [];
  const fullLength: DemoVideo[] = [];
  for (const v of data.videos) {
    if (v.format === "short") shorts.push(v);
    else fullLength.push(v);
  }
  return { shorts, fullLength };
}

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
        const res = await fetch(`/api/exercises/${exerciseId}/demo-videos`, {
          credentials: "include",
        });
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
        body={
          <p className="text-sm text-stone-400">
            Loading suggested videos… first lookup can take a few seconds while we search.
          </p>
        }
      />
    );
  }

  if (data.status === "unavailable") {
    return null;
  }

  const pending = data.status === "pending" && data.videos.length === 0;
  const { shorts, fullLength } = partitionVideos(data);
  const hasAny = shorts.length > 0 || fullLength.length > 0;

  return (
    <DemoVideosSection
      title="How-to videos"
      body={
        <>
          <p className="text-xs text-stone-500 mb-3 leading-relaxed">
            These open on YouTube (third-party). They are not Pono Fit Co. coaching or medical advice. Stop if
            anything hurts and ask a trainer.
          </p>
          {pending ? (
            <p className="text-sm text-stone-400">Finding form videos… usually a few seconds.</p>
          ) : !hasAny ? (
            <p className="text-sm text-stone-500">
              {data.message?.trim() ||
                "No vetted videos cached for this exercise yet."}
            </p>
          ) : (
            <div className="space-y-4">
              {shorts.length > 0 ? (
                <VideoList
                  heading="Shorts"
                  subheading="Quick demos — great for a fast form check."
                  videos={shorts}
                  badge="Short"
                />
              ) : fullLength.length > 0 ? (
                <p className="text-xs text-stone-500 rounded-lg bg-stone-50 border border-stone-100 px-3 py-2">
                  No Shorts for this exercise — here are full-length tutorials below.
                </p>
              ) : null}

              {fullLength.length > 0 ? (
                <VideoList
                  heading="Full length"
                  subheading="Longer tutorials with more detail."
                  videos={fullLength}
                  badge="Full length"
                />
              ) : shorts.length > 0 ? (
                <p className="text-xs text-stone-500">
                  No full-length picks right now — the Shorts above are what we found for this exercise.
                </p>
              ) : null}
            </div>
          )}
        </>
      }
    />
  );
}

function VideoList({
  heading,
  subheading,
  videos,
  badge,
}: {
  heading: string;
  subheading: string;
  videos: DemoVideo[];
  badge: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-stone-800">{heading}</h4>
      <p className="text-xs text-stone-500 mb-2">{subheading}</p>
      <ul className="space-y-2">
        {videos.map((v) => (
          <li key={v.video_id}>
            <a
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-stone-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/50 transition-colors"
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-brand-700 line-clamp-2">{v.title}</span>
                <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                  {badge}
                </span>
              </span>
              {v.channel_title ? (
                <span className="text-xs text-stone-500 block mt-0.5">{v.channel_title}</span>
              ) : null}
              <span className="text-xs text-stone-400 mt-1 inline-block">Open on YouTube ↗</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DemoVideosSection({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="border-b border-stone-100 pb-4 mb-1">
      <h3 className="text-sm font-semibold text-stone-700 mb-2">{title}</h3>
      {body}
    </div>
  );
}