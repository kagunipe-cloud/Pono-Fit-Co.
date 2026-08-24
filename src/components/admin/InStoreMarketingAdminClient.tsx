"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { InStoreMarketingRotationRow } from "@/lib/in-store-marketing";

const PUBLIC_TV_PATH = "/ismtv";

type RotationResponse = {
  rotation: InStoreMarketingRotationRow[];
  active: { id: string; title: string; src: string }[];
};

function toStored(rows: InStoreMarketingRotationRow[]) {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    src: r.src,
    enabled: r.enabled,
  }));
}

export default function InStoreMarketingAdminClient() {
  const [rows, setRows] = useState<InStoreMarketingRotationRow[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/in-store-marketing");
      const data = (await res.json()) as RotationResponse & { error?: string };
      if (!res.ok) {
        setMessage({ type: "err", text: data.error ?? "Failed to load rotation" });
        return;
      }
      setRows(data.rotation ?? []);
      setActiveCount(data.active?.length ?? 0);
    } catch {
      setMessage({ type: "err", text: "Failed to load rotation" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(nextRows: InStoreMarketingRotationRow[]) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/in-store-marketing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides: toStored(nextRows) }),
      });
      const data = (await res.json()) as RotationResponse & { error?: string };
      if (!res.ok) {
        setMessage({ type: "err", text: data.error ?? "Save failed" });
        return;
      }
      setRows(data.rotation ?? nextRows);
      setActiveCount(data.active?.length ?? 0);
      setMessage({ type: "ok", text: "TV rotation updated. The lobby display refreshes within a few minutes." });
    } catch {
      setMessage({ type: "err", text: "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...rows];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    setRows(next);
    void save(next);
  }

  function toggleEnabled(index: number) {
    const next = rows.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r));
    setRows(next);
    void save(next);
  }

  function removeFromRotation(index: number) {
    const row = rows[index];
    if (!row) return;
    const next = row.inCatalog
      ? rows.map((r, i) => (i === index ? { ...r, enabled: false } : r))
      : rows.filter((_, i) => i !== index);
    setRows(next);
    void save(next);
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setMessage({ type: "err", text: "Choose an image file first." });
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("title", uploadTitle.trim() || file.name.replace(/\.[^.]+$/, ""));
      const res = await fetch("/api/admin/in-store-marketing/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error ?? "Upload failed" });
        return;
      }
      setUploadTitle("");
      form.reset();
      setMessage({ type: "ok", text: "Uploaded and added to rotation." });
      await load();
    } catch {
      setMessage({ type: "err", text: "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  const activeRows = rows.filter((r) => r.enabled);

  return (
    <>
      {message && (
        <p
          className={`mb-6 rounded-lg px-3 py-2 text-sm ${
            message.type === "ok"
              ? "border border-brand-100 bg-brand-50 text-stone-800"
              : "border border-red-100 bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mb-8 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
        <p>
          <strong>{activeCount}</strong> slide{activeCount === 1 ? "" : "s"} in rotation. The TV at{" "}
          <Link href={PUBLIC_TV_PATH} target="_blank" className="text-brand-700 underline">
            {PUBLIC_TV_PATH}
          </Link>{" "}
          picks up changes automatically — no new URL needed.
        </p>
      </div>

      {loading ? (
        <p className="text-stone-600">Loading…</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((slide, index) => (
            <article
              key={slide.id}
              className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                slide.enabled ? "border-brand-200" : "border-stone-200 opacity-80"
              }`}
            >
              <div className="relative aspect-video bg-stone-950">
                <Image src={slide.src} alt="" fill unoptimized className="object-contain" sizes="33vw" />
                {!slide.enabled && (
                  <span className="absolute left-3 top-3 rounded-full bg-stone-900/80 px-3 py-1 text-xs font-bold uppercase text-white">
                    Off rotation
                  </span>
                )}
              </div>
              <div className="p-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-stone-400">
                  {slide.enabled ? `On TV · #${activeRows.findIndex((r) => r.id === slide.id) + 1}` : "Not on TV"}
                </p>
                <h2 className="mt-1 text-lg font-bold text-stone-900">{slide.title}</h2>
                <p className="mt-1 text-sm text-stone-600 line-clamp-2">{slide.description || slide.src}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => toggleEnabled(index)}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {slide.enabled ? "Remove from rotation" : "Add to rotation"}
                  </button>
                  {slide.enabled && (
                    <>
                      <button
                        type="button"
                        disabled={saving || index === 0}
                        onClick={() => move(index, -1)}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={saving || index >= rows.length - 1}
                        onClick={() => move(index, 1)}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                      >
                        ↓
                      </button>
                    </>
                  )}
                  {!slide.inCatalog && slide.enabled && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => removeFromRotation(index)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete upload
                    </button>
                  )}
                  {slide.enabled && (
                    <Link
                      href={`${PUBLIC_TV_PATH}?page=${activeRows.findIndex((r) => r.id === slide.id) + 1}`}
                      target="_blank"
                      className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                    >
                      Preview on TV ↗
                    </Link>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <form onSubmit={handleUpload} className="mt-10 rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-bold text-stone-900">Upload a new slide</h2>
        <p className="mt-1 text-sm text-stone-600">Landscape PNG or SVG, 16:9 works best. Added to rotation automatically.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-[200px] flex-1">
            <span className="text-xs font-medium text-stone-600">Title</span>
            <input
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="Event name"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block min-w-[200px] flex-1">
            <span className="text-xs font-medium text-stone-600">Image file</span>
            <input name="file" type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/*" className="mt-1 block w-full text-sm" />
          </label>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-semibold text-[#9ef6b2] hover:bg-stone-800 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload & add"}
          </button>
        </div>
      </form>
    </>
  );
}
