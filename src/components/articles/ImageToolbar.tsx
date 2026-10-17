"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { WpMedia } from "@/lib/wordpress/client";
import { fieldStyle } from "./shared";
import { sizeLabel } from "./WpMediaBrowser";

type ImageAttrs = { src: string; width?: number | string | null; height?: number | string | null; class?: string | null };

const ALIGNS = [
  { id: "", label: "Default" },
  { id: "alignleft", label: "Left" },
  { id: "aligncenter", label: "Center" },
  { id: "alignright", label: "Right" },
];

/** The image's classes with the ones matching `group` replaced by `value`. */
function withClass(current: string | null | undefined, group: RegExp, value: string): string | null {
  const parts = (current ?? "").split(/\s+/).filter((c) => c && !group.test(c));
  if (value) parts.unshift(value);
  return parts.length ? parts.join(" ") : null;
}

const mediaCache = new Map<number, Promise<WpMedia | null>>();
function wpMedia(projectId: string, id: number): Promise<WpMedia | null> {
  if (!mediaCache.has(id)) {
    mediaCache.set(
      id,
      fetch(`/api/wordpress/media?project=${encodeURIComponent(projectId)}&id=${id}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ media?: WpMedia }>) : { media: undefined }))
        .then((d) => d.media ?? null)
        .catch(() => null)
    );
  }
  return mediaCache.get(id)!;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/**
 * Size and placement of the selected image: one of WordPress's sizes (for images in its media library), exact
 * width × height (the ratio stays locked unless unticked), and alignment. Dragging the image's corners works too.
 */
export function ImageToolbar({ editor, projectId, wordpress }: { editor: Editor; projectId: string; wordpress: boolean }) {
  const attrs = editor.getAttributes("image") as ImageAttrs;
  const width = num(attrs.width);
  const height = num(attrs.height);
  const wpId = Number((attrs.class ?? "").match(/\bwp-image-(\d+)\b/)?.[1] ?? 0);
  const sizeName = (attrs.class ?? "").match(/\bsize-([\w-]+)\b/)?.[1] ?? "";
  const align = (attrs.class ?? "").match(/\b(align(?:left|center|right|none))\b/)?.[1] ?? "";
  const [media, setMedia] = useState<WpMedia | null>(null);
  const [lock, setLock] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (wordpress && wpId) void wpMedia(projectId, wpId).then((m) => !cancelled && setMedia(m));
    return () => {
      cancelled = true;
    };
  }, [projectId, wpId, wordpress]);

  const set = (patch: Partial<ImageAttrs>) => {
    editor.chain().updateAttributes("image", patch).run();
    // The resizable image view only follows drags, so show typed sizes on it directly.
    if ("width" in patch || "height" in patch) {
      const dom = editor.view.nodeDOM(editor.state.selection.from);
      const img = dom instanceof HTMLElement ? (dom.tagName === "IMG" ? dom : dom.querySelector("img")) : null;
      if (img) {
        img.style.width = patch.width ? `${patch.width}px` : "";
        img.style.height = patch.height ? `${patch.height}px` : "";
      }
    }
  };

  /** Width/height ratio: from the set size, else from the picture itself. */
  const ratio = (): number | null => {
    if (width && height) return height / width;
    const img = [...editor.view.dom.querySelectorAll("img")].find((i) => i.getAttribute("src") === attrs.src);
    return img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : null;
  };

  function setWidth(v: string) {
    const w = num(v);
    const r = ratio();
    set({ width: w, height: lock && w && r ? Math.round(w * r) : w ? height : null });
  }
  function setHeight(v: string) {
    const h = num(v);
    const r = ratio();
    set({ height: h, width: lock && h && r ? Math.round(h / r) : h ? width : null });
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2" style={{ borderColor: "var(--border-hairline)" }}>
      {media ? (
        <label className="flex items-center gap-1.5">
          <span style={{ color: "var(--text-secondary)" }}>WordPress size</span>
          <select
            value={sizeName}
            onChange={(e) => {
              const s = media.sizes.find((x) => x.name === e.target.value);
              if (s) set({ src: s.url, width: s.width || null, height: s.height || null, class: withClass(attrs.class, /^size-/, `size-${s.name}`) });
            }}
            className="rounded-md border px-2 py-1 text-xs"
            style={fieldStyle}
            aria-label="WordPress image size"
          >
            {!media.sizes.some((s) => s.name === sizeName) ? <option value={sizeName}>Custom</option> : null}
            {media.sizes.map((s) => (
              <option key={s.name} value={s.name}>
                {sizeLabel(s.name)} ({s.width}×{s.height})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex items-center gap-1">
        <span style={{ color: "var(--text-secondary)" }}>W</span>
        <input type="number" min={1} value={width ?? ""} placeholder="auto" onChange={(e) => setWidth(e.target.value)} className="w-20 rounded-md border px-2 py-1 text-xs" style={fieldStyle} aria-label="Image width in pixels" />
      </label>
      <span style={{ color: "var(--text-muted)" }}>×</span>
      <label className="flex items-center gap-1">
        <span style={{ color: "var(--text-secondary)" }}>H</span>
        <input type="number" min={1} value={height ?? ""} placeholder="auto" onChange={(e) => setHeight(e.target.value)} className="w-20 rounded-md border px-2 py-1 text-xs" style={fieldStyle} aria-label="Image height in pixels" />
      </label>
      <span style={{ color: "var(--text-muted)" }}>px</span>
      <label className="flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> keep ratio
      </label>
      {width || height ? (
        <button type="button" onClick={() => set({ width: null, height: null })} className="underline" style={{ color: "var(--text-muted)" }}>
          original size
        </button>
      ) : null}
      <label className="ml-auto flex items-center gap-1.5">
        <span style={{ color: "var(--text-secondary)" }}>Align</span>
        <select value={align} onChange={(e) => set({ class: withClass(attrs.class, /^align/, e.target.value) })} className="rounded-md border px-2 py-1 text-xs" style={fieldStyle} aria-label="Image alignment">
          {ALIGNS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
