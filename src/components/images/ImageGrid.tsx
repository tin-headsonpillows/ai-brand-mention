"use client";

import { useState } from "react";
import type { SelectedImage } from "./imageClient";

/**
 * Masonry grid of images with a select checkbox on each and a larger preview on click. `extra` renders
 * per-tile actions (e.g. delete in the library).
 */
export function ImageGrid({
  images,
  selected,
  onToggle,
  extra,
}: {
  images: SelectedImage[];
  selected: Set<string>;
  onToggle: (image: SelectedImage) => void;
  extra?: (image: SelectedImage) => React.ReactNode;
}) {
  const [preview, setPreview] = useState<SelectedImage | null>(null);

  return (
    <>
      <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
        {images.map((image) => {
          const isSelected = selected.has(image.key);
          return (
            <figure
              key={image.key}
              className="group relative mb-3 break-inside-avoid overflow-hidden rounded-lg border"
              style={{
                borderColor: isSelected ? "var(--series-1)" : "var(--border-hairline)",
                boxShadow: isSelected ? "0 0 0 2px var(--series-1)" : undefined,
                background: "var(--surface-1)",
              }}
            >
              <button type="button" onClick={() => setPreview(image)} className="block w-full" title="Preview">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote search thumbnails */}
                <img
                  src={image.thumb}
                  alt={image.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="block w-full"
                  style={{ aspectRatio: image.width && image.height ? `${image.width} / ${image.height}` : undefined, objectFit: "cover", background: "var(--page-plane)" }}
                />
              </button>
              <label
                className="absolute left-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-2"
                style={{ background: isSelected ? "var(--series-1)" : "rgba(255,255,255,0.9)", borderColor: isSelected ? "var(--series-1)" : "rgba(0,0,0,0.25)" }}
                title={isSelected ? "Remove from selection" : "Select for download"}
              >
                <input type="checkbox" checked={isSelected} onChange={() => onToggle(image)} className="sr-only" aria-label={`Select ${image.title}`} />
                {isSelected ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                    <path d="M2 6.5 4.8 9 10 3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : null}
              </label>
              <figcaption className="flex flex-col gap-0.5 px-2 py-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span className="truncate" style={{ color: "var(--text-secondary)" }} title={image.title}>
                  {image.title || "Untitled"}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{image.kind === "google" ? image.pageUrl?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : ""}</span>
                  {image.width && image.height ? <span className="tabular">{image.width}×{image.height}</span> : null}
                </span>
                {extra ? extra(image) : null}
              </figcaption>
            </figure>
          );
        })}
      </div>

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="flex max-h-full max-w-5xl flex-col gap-3 rounded-xl p-3" style={{ background: "var(--surface-1)" }} onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- full-size preview from the source */}
            <img
              src={preview.src}
              alt={preview.title}
              referrerPolicy="no-referrer"
              className="max-h-[75vh] w-auto rounded object-contain"
              onError={(e) => {
                // Hosts that refuse hotlinking: fall back to the thumbnail.
                if (e.currentTarget.src !== preview.thumb) e.currentTarget.src = preview.thumb;
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="max-w-xl truncate" style={{ color: "var(--text-secondary)" }}>
                {preview.title}
                {preview.width && preview.height ? ` · ${preview.width}×${preview.height}px` : ""}
              </span>
              <span className="flex gap-2">
                {preview.pageUrl ? (
                  <a href={preview.pageUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
                    Open source page
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => onToggle(preview)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: "var(--series-1)" }}
                >
                  {selected.has(preview.key) ? "Remove from selection" : "Select"}
                </button>
                <button type="button" onClick={() => setPreview(null)} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
                  Close
                </button>
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
