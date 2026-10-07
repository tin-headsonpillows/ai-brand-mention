"use client";

import { useEffect, useState } from "react";
import type { ArticleImageRef } from "@/lib/articles/types";
import type { LibraryItem } from "@/lib/images/types";
import { libraryFileUrl } from "@/lib/images/libraryUrl";
import { Segmented } from "@/components/tracking/ui";
import { Field, Modal, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

type Source = "library" | "url" | "upload";
const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Picks an image for an article: from the project's image library (Images tab), from a link on any website,
 * or a new upload. Links and uploads are saved to the library first, so the image stays available and can be
 * uploaded to WordPress later.
 */
export function ImagePicker({
  projectId,
  title,
  defaultAlt,
  onPick,
  onClose,
}: {
  projectId: string;
  title: string;
  defaultAlt?: string;
  onPick: (image: ArticleImageRef) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>("library");
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [chosen, setChosen] = useState<{ src: string; title: string } | null>(null);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState(defaultAlt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/images/library?project=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { items?: LibraryItem[] };
      if (!cancelled) setItems(data.items ?? []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function saveFromUrl() {
    const link = url.trim();
    if (!/^https?:\/\//i.test(link)) {
      setError("Paste a full image link starting with https://");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/images/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, images: [{ url: link, kind: "web", title: alt || link.split("/").pop() || "Web image" }] }),
      });
      const data = (await res.json().catch(() => ({}))) as { saved?: LibraryItem[]; already?: LibraryItem[]; failed?: Array<{ error: string }>; error?: string };
      const item = data.saved?.[0] ?? data.already?.[0];
      if (!item) throw new Error(data.failed?.[0]?.error ?? data.error ?? "Couldn't download that image");
      finish(libraryFileUrl(projectId, item.id), item.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't download that image");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!UPLOAD_TYPES.includes(file.type)) {
      setError("Upload a JPG, PNG, WebP or GIF image");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Images must be under 4 MB - resize it in the Images tab first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = URL.createObjectURL(file);
      });
      const params = new URLSearchParams({ project: projectId, kind: "upload", title: file.name.replace(/\.[^.]+$/, ""), width: String(dims.w), height: String(dims.h) });
      const res = await fetch(`/api/images/library?${params}`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const data = (await res.json().catch(() => ({}))) as { item?: LibraryItem; error?: string };
      if (!res.ok || !data.item) throw new Error(data.error ?? "Upload failed");
      finish(libraryFileUrl(projectId, data.item.id), data.item.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function finish(src: string, imageTitle: string) {
    onPick({ src, alt: alt.trim(), title: imageTitle });
    onClose();
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      width="max-w-4xl"
      footer={
        source === "library" ? (
          <>
            <button type="button" onClick={onClose} className={buttonSecondary} style={secondaryStyle}>
              Cancel
            </button>
            <button type="button" disabled={!chosen} onClick={() => chosen && finish(chosen.src, chosen.title)} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              Use this image
            </button>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Segmented
            value={source}
            options={[
              { value: "library", label: `Project library${items ? ` (${items.length})` : ""}` },
              { value: "url", label: "From a link" },
              { value: "upload", label: "Upload" },
            ]}
            onChange={(v) => {
              setSource(v);
              setError(null);
            }}
            ariaLabel="Image source"
          />
          <div className="w-full sm:w-80">
            <Field label="Alt text" hint="Describe the image for screen readers and search engines.">
              <input value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="e.g. Pool terrace at sunrise overlooking My Khe beach" className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
            </Field>
          </div>
        </div>

        {source === "library" ? (
          items === null ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading library...
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No images in this project yet. Save some from the Images tab, or use a link or upload here.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {items.map((item) => {
                const src = libraryFileUrl(projectId, item.id);
                const active = chosen?.src === src;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setChosen({ src, title: item.title })}
                    className="flex flex-col overflow-hidden rounded-lg border text-left"
                    style={{ borderColor: active ? "var(--series-1)" : "var(--border-hairline)", boxShadow: active ? "0 0 0 2px var(--series-1)" : undefined }}
                    aria-pressed={active}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- library thumbnail */}
                    <img src={src} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" style={{ background: "var(--page-plane)" }} />
                    <span className="truncate px-2 py-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {item.title}
                      {item.width ? ` · ${item.width}×${item.height}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )
        ) : source === "url" ? (
          <div className="flex flex-col gap-3">
            <Field label="Image link" hint="A direct link to an image on any public website. It's copied into the project library.">
              <div className="flex gap-2">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/photo.jpg" className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
                <button type="button" disabled={busy || !url.trim()} onClick={() => void saveFromUrl()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
                  {busy ? "Saving..." : "Save & use"}
                </button>
              </div>
            </Field>
            {/^https?:\/\//i.test(url.trim()) ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview through the guarded proxy
              <img src={`/api/images/proxy?url=${encodeURIComponent(url.trim())}`} alt="" className="max-h-64 self-start rounded-lg border object-contain" style={{ borderColor: "var(--border-hairline)" }} />
            ) : null}
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center" style={{ borderColor: "var(--border-hairline)" }}>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {busy ? "Uploading..." : "Choose an image to upload"}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              JPG, PNG, WebP or GIF, up to 4 MB. Saved to the project library.
            </span>
            <input type="file" accept={UPLOAD_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
        )}

        {error ? (
          <p className="text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
