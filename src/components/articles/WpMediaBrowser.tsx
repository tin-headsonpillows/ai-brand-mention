"use client";

import { useEffect, useState } from "react";
import type { WpMedia } from "@/lib/wordpress/client";
import { buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** Uploads go through a server function that accepts up to ~4.5 MB; bigger photos are shrunk first. */
const MAX_BYTES = 4_300_000;

/** A photo too big to upload, re-encoded as a JPEG at most 2560 px wide (GIFs are left alone). */
export async function shrinkForUpload(file: File): Promise<File> {
  if (file.size <= MAX_BYTES || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  for (const [maxSide, quality] of [
    [2560, 0.88],
    [2048, 0.82],
    [1600, 0.78],
  ] as const) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  }
  throw new Error("This image is too large even after shrinking - export it smaller first.");
}

export const SIZE_LABEL: Record<string, string> = { thumbnail: "Thumbnail", medium: "Medium", medium_large: "Medium large", large: "Large", full: "Full size" };
export const sizeLabel = (name: string) => SIZE_LABEL[name] ?? name.replace(/[-_]/g, " ");

export interface WpPick {
  media: WpMedia;
  size: WpMedia["sizes"][number];
}

/**
 * The WordPress site's media library: search and pick an image (and which of WordPress's sizes to use), or upload a
 * new file straight to WordPress - its link comes back ready to insert.
 */
export function WpMediaBrowser({ projectId, alt, onPick }: { projectId: string; alt: string; onPick: (pick: WpPick) => void }) {
  const [items, setItems] = useState<WpMedia[] | null>(null);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<WpMedia | null>(null);
  const [size, setSize] = useState("large");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ project: projectId, page: String(page), ...(query ? { search: query } : {}) });
    fetch(`/api/wordpress/media?${params}`, { cache: "no-store" })
      .then(async (res) => ({ res, data: (await res.json().catch(() => ({}))) as { items?: WpMedia[]; more?: boolean; error?: string } }))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? "Couldn't load the media library");
        else {
          setItems((prev) => {
            const merged = page === 1 ? (data.items ?? []) : [...(prev ?? []), ...(data.items ?? [])];
            return merged.filter((m, i) => merged.findIndex((x) => x.id === m.id) === i);
          });
          setMore(Boolean(data.more));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, page, query]);

  function choose(media: WpMedia) {
    setChosen(media);
    setSize(media.sizes.some((s) => s.name === "large") ? "large" : "full");
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!UPLOAD_TYPES.includes(file.type)) return setError("Upload a JPG, PNG, WebP or GIF image");
    setBusy(true);
    setError(null);
    try {
      const ready = await shrinkForUpload(file);
      const form = new FormData();
      form.set("project", projectId);
      form.set("file", ready);
      form.set("alt", alt);
      const res = await fetch("/api/wordpress/media", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { media?: WpMedia; error?: string };
      if (!res.ok || !data.media) throw new Error(data.error ?? `Upload failed (${res.status})`);
      setItems((prev) => [data.media!, ...(prev ?? []).filter((m) => m.id !== data.media!.id)]);
      choose(data.media);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const picked = chosen?.sizes.find((s) => s.name === size) ?? chosen?.sizes.at(-1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-[220px] flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the WordPress media library" className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} aria-label="Search media" />
          <button type="submit" className={buttonSecondary} style={secondaryStyle}>
            Search
          </button>
        </form>
        <label className={`${buttonPrimary} cursor-pointer`} style={{ background: "var(--series-1)" }}>
          {busy ? "Uploading..." : "Upload to WordPress"}
          <input type="file" accept={UPLOAD_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      </div>

      {items === null && !error ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading the media library...
        </p>
      ) : items?.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No images{query ? ` matching "${query}"` : ""} in WordPress yet.
        </p>
      ) : (
        <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-5">
          {(items ?? []).map((m) => {
            const thumb = m.sizes.find((s) => s.name === "medium") ?? m.sizes.find((s) => s.name === "thumbnail") ?? m.sizes[0];
            const active = chosen?.id === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => choose(m)}
                className="flex flex-col overflow-hidden rounded-lg border text-left"
                style={{ borderColor: active ? "var(--series-1)" : "var(--border-hairline)", boxShadow: active ? "0 0 0 2px var(--series-1)" : undefined }}
                aria-pressed={active}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- WordPress thumbnail */}
                <img src={thumb?.url} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" style={{ background: "var(--page-plane)" }} />
                <span className="truncate px-2 py-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {m.title || m.alt || `#${m.id}`} · {m.width}×{m.height}
                </span>
              </button>
            );
          })}
          {more ? (
            <button type="button" onClick={() => setPage((p) => p + 1)} className={buttonSecondary} style={secondaryStyle}>
              Load more
            </button>
          ) : null}
        </div>
      )}

      {chosen && picked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Size</span>
          <select value={picked.name} onChange={(e) => setSize(e.target.value)} className="rounded-md border px-2 py-1 text-xs" style={fieldStyle} aria-label="Image size">
            {chosen.sizes.map((s) => (
              <option key={s.name} value={s.name}>
                {sizeLabel(s.name)} - {s.width}×{s.height}
              </option>
            ))}
          </select>
          <a href={picked.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline" style={{ color: "var(--text-muted)" }}>
            {picked.url}
          </a>
          <button type="button" onClick={() => onPick({ media: chosen, size: picked })} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
            Use this image
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
