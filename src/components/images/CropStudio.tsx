"use client";

import { useEffect, useRef, useState } from "react";
import {
  SIZE_PRESETS,
  centeredRect,
  clampRect,
  outputSize,
  resizeFromCorner,
  safeFileName,
  upscaleFactor,
  type CropMode,
  type Rect,
} from "@/lib/images/crop";
import { Segmented } from "@/components/tracking/ui";
import {
  downloadBlob,
  loadImage,
  renderJpeg,
  saveJpegToLibrary,
  zipFiles,
  type CropSettings,
  type SelectedImage,
} from "./imageClient";

const VIEW_W = 720;
const VIEW_H = 460;

const MODE_OPTIONS: Array<{ value: CropMode; label: string; title: string }> = [
  { value: "crop", label: "Crop to size", title: "Exact width × height, cut from a box of the same shape - never stretched" },
  { value: "resize", label: "Resize, keep proportions", title: "Whole image scaled to a width; height follows the original shape" },
  { value: "original", label: "Original size", title: "Whole image at its own size, saved as JPG" },
];

interface Loaded {
  img: HTMLImageElement;
  w: number;
  h: number;
}

type Drag =
  | { type: "move"; startX: number; startY: number; rect: Rect }
  | { type: "corner"; anchor: { x: number; y: number } };

function defaultSettings(image: SelectedImage, base?: CropSettings): CropSettings {
  if (image.target) {
    return { mode: "crop", presetId: "custom", width: image.target.width, height: image.target.height, rect: null, quality: base?.quality ?? 0.9, name: safeFileName(image.title) };
  }
  return {
    mode: base?.mode ?? "crop",
    presetId: base?.presetId ?? "square",
    width: base?.width ?? 1080,
    height: base?.height ?? 1080,
    rect: null,
    quality: base?.quality ?? 0.9,
    name: safeFileName(image.title),
  };
}

export function CropStudio({
  images,
  projectId,
  onClose,
  onSaved,
}: {
  images: SelectedImage[];
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [activeKey, setActiveKey] = useState(images[0]?.key ?? "");
  const [settings, setSettings] = useState<Record<string, CropSettings>>(() =>
    Object.fromEntries(images.map((img) => [img.key, defaultSettings(img)]))
  );
  const [loaded, setLoaded] = useState<Record<string, Loaded | "error">>({});
  const [applyAll, setApplyAll] = useState(true);
  const [keepCopy, setKeepCopy] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  // Load every selected image once (through the proxy), then place each crop box.
  useEffect(() => {
    let cancelled = false;
    for (const image of images) {
      loadImage(image.src)
        .then((img) => {
          if (cancelled) return;
          setLoaded((m) => ({ ...m, [image.key]: { img, w: img.naturalWidth, h: img.naturalHeight } }));
        })
        .catch(() => {
          if (!cancelled) setLoaded((m) => ({ ...m, [image.key]: "error" }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [images]);

  const active = images.find((i) => i.key === activeKey) ?? images[0];
  const activeLoaded = active ? loaded[active.key] : undefined;
  const s = active ? settings[active.key] : undefined;
  const source = activeLoaded && activeLoaded !== "error" ? activeLoaded : null;

  /** The crop box for an image under given settings (centred until the user moves it). */
  function rectFor(key: string, cfg: CropSettings): Rect | null {
    const l = loaded[key];
    if (!l || l === "error") return null;
    return cfg.rect ?? centeredRect(l.w, l.h, cfg.width, cfg.height);
  }

  function update(change: Partial<CropSettings>, resetRect: boolean) {
    if (!active) return;
    setSettings((all) => {
      const next = { ...all };
      const targets = applyAll ? images.map((i) => i.key) : [active.key];
      for (const key of targets) {
        const own = all[key];
        // Shared settings apply to all; a generated image keeps its own requested size unless edited directly.
        const shared = key === active.key ? change : { ...change, name: undefined };
        const merged: CropSettings = { ...own, ...Object.fromEntries(Object.entries(shared).filter(([, v]) => v !== undefined)) };
        if (resetRect) merged.rect = null;
        next[key] = merged;
      }
      return next;
    });
  }

  function setRect(rect: Rect) {
    if (!active) return;
    setSettings((all) => ({ ...all, [active.key]: { ...all[active.key], rect } }));
  }

  // --- Crop box interaction -------------------------------------------------------------------
  const scale = source ? Math.min(VIEW_W / source.w, VIEW_H / source.h, 1) : 1;
  const rect = active && s && s.mode === "crop" ? rectFor(active.key, s) : null;

  function toImage(e: React.PointerEvent): { x: number; y: number } {
    const box = viewRef.current!.getBoundingClientRect();
    return { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
  }

  function startMove(e: React.PointerEvent) {
    if (!rect) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toImage(e);
    dragRef.current = { type: "move", startX: p.x, startY: p.y, rect };
  }

  function startCorner(e: React.PointerEvent, corner: "nw" | "ne" | "sw" | "se") {
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const anchor = {
      x: corner.includes("w") ? rect.x + rect.w : rect.x,
      y: corner.includes("n") ? rect.y + rect.h : rect.y,
    };
    dragRef.current = { type: "corner", anchor };
  }

  function onMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !source || !s) return;
    const p = toImage(e);
    if (drag.type === "move") {
      setRect(clampRect({ ...drag.rect, x: drag.rect.x + p.x - drag.startX, y: drag.rect.y + p.y - drag.startY }, source.w, source.h));
    } else {
      setRect(resizeFromCorner(drag.anchor, p, s.width / s.height, source.w, source.h));
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  // --- Export ---------------------------------------------------------------------------------
  async function exportOne(image: SelectedImage): Promise<{ name: string; blob: Blob; out: { width: number; height: number } } | null> {
    const l = loaded[image.key];
    const cfg = settings[image.key];
    if (!l || l === "error" || !cfg) return null;
    const out = outputSize(cfg.mode, l.w, l.h, cfg);
    const src = cfg.mode === "crop" ? rectFor(image.key, cfg)! : { x: 0, y: 0, w: l.w, h: l.h };
    const blob = await renderJpeg(l.img, src, out, cfg.quality);
    return { name: `${safeFileName(cfg.name, "image")}-${out.width}x${out.height}.jpg`, blob, out };
  }

  async function keep(image: SelectedImage, blob: Blob, out: { width: number; height: number }): Promise<boolean> {
    const cfg = settings[image.key];
    // An untouched library image is already saved.
    if (!keepCopy || (image.libraryId && cfg.mode === "original")) return true;
    return saveJpegToLibrary(projectId, blob, {
      kind: image.kind,
      title: image.title || cfg.name,
      width: out.width,
      height: out.height,
      sourceUrl: image.src,
      pageUrl: image.pageUrl,
    });
  }

  async function downloadActive() {
    if (!active) return;
    setBusy("Preparing your JPG...");
    setMessage(null);
    try {
      const result = await exportOne(active);
      if (!result) throw new Error("This image hasn't loaded");
      downloadBlob(result.blob, result.name);
      const kept = await keep(active, result.blob, result.out);
      setMessage(kept ? `Downloaded ${result.name}${keepCopy ? " and saved it to the project library" : ""}.` : `Downloaded ${result.name} (too large to keep in the library).`);
      if (keepCopy) onSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function downloadAll() {
    setBusy(`Preparing ${images.length} JPGs...`);
    setMessage(null);
    try {
      const files: Array<{ name: string; blob: Blob }> = [];
      let skipped = 0;
      let notKept = 0;
      for (const image of images) {
        const result = await exportOne(image);
        if (!result) {
          skipped++;
          continue;
        }
        files.push({ name: result.name, blob: result.blob });
        if (!(await keep(image, result.blob, result.out))) notKept++;
      }
      if (files.length === 0) throw new Error("None of the images could be loaded");
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(await zipFiles(files), `images-${stamp}.zip`);
      setMessage(
        `Downloaded ${files.length} JPG${files.length === 1 ? "" : "s"} as a ZIP` +
          (skipped ? ` - ${skipped} couldn't be loaded and were left out` : "") +
          (notKept ? ` - ${notKept} too large to keep in the library` : "") +
          "."
      );
      if (keepCopy) onSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  if (!active || !s) return null;
  const out = source ? outputSize(s.mode, source.w, source.h, s) : null;
  const upscale = source && out && rect ? upscaleFactor(s.mode, rect, source.w, out) : source && out ? upscaleFactor(s.mode, { x: 0, y: 0, w: source.w, h: source.h }, source.w, out) : 1;
  const presetOptions = [...SIZE_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom size" }];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Crop and download">
      <div className="flex w-full max-w-[1300px] flex-col gap-4 rounded-xl border p-4" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
        <header className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Crop &amp; download
            </h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Drag the box to choose what&apos;s kept, pull a corner to zoom. The box keeps the output&apos;s shape, so nothing is stretched.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
            Close
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[110px_minmax(0,1fr)_300px]">
          {/* Selected images */}
          <ul className="flex gap-2 overflow-x-auto lg:max-h-[520px] lg:flex-col lg:overflow-y-auto">
            {images.map((img) => (
              <li key={img.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveKey(img.key)}
                  className="block overflow-hidden rounded-md border-2"
                  style={{ borderColor: img.key === active.key ? "var(--series-1)" : "transparent" }}
                  title={img.title}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnails */}
                  <img src={img.thumb} alt="" referrerPolicy="no-referrer" className="h-20 w-24 object-cover" />
                </button>
                {loaded[img.key] === "error" ? (
                  <span className="block text-[10px]" style={{ color: "var(--status-critical)" }}>
                    can&apos;t load
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          {/* Crop view */}
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-lg p-2" style={{ background: "var(--page-plane)" }}>
            {activeLoaded === "error" ? (
              <p className="max-w-sm text-center text-sm" style={{ color: "var(--status-critical)" }}>
                This image couldn&apos;t be loaded - the site may block downloads. Pick another, or open the source page.
              </p>
            ) : !source ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Loading image...
              </p>
            ) : (
              <div
                ref={viewRef}
                className="relative select-none overflow-hidden"
                style={{ width: source.w * scale, height: source.h * scale, touchAction: "none" }}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- canvas source preview */}
                <img src={source.img.src} alt={active.title} draggable={false} className="absolute inset-0 h-full w-full" />
                {rect ? (
                  <div
                    className="absolute cursor-move"
                    style={{
                      left: rect.x * scale,
                      top: rect.y * scale,
                      width: rect.w * scale,
                      height: rect.h * scale,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                      outline: "2px solid #fff",
                    }}
                    onPointerDown={startMove}
                  >
                    {/* rule-of-thirds guides */}
                    <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(to right, transparent 33.2%, rgba(255,255,255,0.45) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,0.45) 66.6%, transparent 66.8%), linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,0.45) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,0.45) 66.6%, transparent 66.8%)" }} />
                    {(["nw", "ne", "sw", "se"] as const).map((c) => (
                      <span
                        key={c}
                        onPointerDown={(e) => startCorner(e, c)}
                        className="absolute h-4 w-4 rounded-sm border-2"
                        style={{
                          background: "var(--series-1)",
                          borderColor: "#fff",
                          left: c.includes("w") ? -8 : undefined,
                          right: c.includes("e") ? -8 : undefined,
                          top: c.includes("n") ? -8 : undefined,
                          bottom: c.includes("s") ? -8 : undefined,
                          cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                        }}
                        aria-label={`Resize crop from ${c} corner`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            {source ? (
              <p className="text-xs tabular" style={{ color: "var(--text-muted)" }}>
                Source {source.w} × {source.h}px
                {rect ? ` · crop ${Math.round(rect.w)} × ${Math.round(rect.h)}px` : ""}
              </p>
            ) : null}
          </div>

          {/* Settings */}
          <div className="flex flex-col gap-3 text-sm">
            <Segmented value={s.mode} options={MODE_OPTIONS} onChange={(mode) => update({ mode }, true)} ariaLabel="Output mode" />

            {s.mode === "crop" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Size
                  </span>
                  <select
                    value={s.presetId}
                    onChange={(e) => {
                      const preset = SIZE_PRESETS.find((p) => p.id === e.target.value);
                      update(preset ? { presetId: preset.id, width: preset.width, height: preset.height } : { presetId: "custom" }, true);
                    }}
                    className="rounded-lg border px-2 py-1.5 text-sm"
                    style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" }}
                  >
                    {presetOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end gap-2">
                  <NumberField label="Width (px)" value={s.width} onChange={(v) => update({ presetId: "custom", width: v }, true)} />
                  <span className="pb-2" style={{ color: "var(--text-muted)" }}>
                    ×
                  </span>
                  <NumberField label="Height (px)" value={s.height} onChange={(v) => update({ presetId: "custom", height: v }, true)} />
                </div>
                <button type="button" onClick={() => update({}, true)} className="self-start text-xs font-medium" style={{ color: "var(--series-1)" }}>
                  Re-centre crop box
                </button>
              </>
            ) : s.mode === "resize" ? (
              <div className="flex items-end gap-2">
                <NumberField label="Width (px)" value={s.width} onChange={(v) => update({ width: v }, false)} />
                <span className="pb-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  → height {source ? Math.round((s.width * source.h) / source.w) : "–"} px (kept in proportion)
                </span>
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                The whole image at its original size{source ? ` (${source.w} × ${source.h}px)` : ""}, saved as JPG.
              </p>
            )}

            {out ? (
              <p className="text-xs tabular" style={{ color: "var(--text-secondary)" }}>
                Output: <strong style={{ color: "var(--text-primary)" }}>{out.width} × {out.height}px</strong> JPG
                {upscale > 1.3 ? (
                  <span style={{ color: "var(--status-warning)" }}> · enlarged {upscale.toFixed(1)}× - may look soft</span>
                ) : null}
              </p>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                JPG quality <span className="tabular">{Math.round(s.quality * 100)}</span>
              </span>
              <input type="range" min={60} max={100} value={Math.round(s.quality * 100)} onChange={(e) => update({ quality: Number(e.target.value) / 100 }, false)} />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                File name
              </span>
              <input
                value={s.name}
                onChange={(e) => setSettings((all) => ({ ...all, [active.key]: { ...all[active.key], name: e.target.value } }))}
                className="rounded-lg border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" }}
              />
            </label>

            {images.length > 1 ? (
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
                Use these size settings for all {images.length} images
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} />
              Also save to this project&apos;s image library
            </label>

            <div className="mt-1 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void downloadActive()}
                disabled={!!busy || !source}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--series-1)" }}
              >
                Download this image (.jpg)
              </button>
              {images.length > 1 ? (
                <button
                  type="button"
                  onClick={() => void downloadAll()}
                  disabled={!!busy}
                  className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                  style={{ borderColor: "var(--series-1)", color: "var(--text-primary)" }}
                >
                  Download all {images.length} as ZIP
                </button>
              ) : null}
            </div>
            {busy || message ? (
              <p className="text-xs" style={{ color: busy ? "var(--text-muted)" : "var(--text-secondary)" }}>
                {busy ?? message}
              </p>
            ) : null}
            {active.pageUrl ? (
              <a href={active.pageUrl} target="_blank" rel="noreferrer" className="text-xs hover:underline" style={{ color: "var(--series-1)" }}>
                Source page - check usage rights before publishing
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  // Follow outside changes (e.g. a preset) without fighting the user's typing.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }
  function commit() {
    const n = Math.round(Number(draft));
    if (n >= 16 && n <= 8000) onChange(n);
    else setDraft(String(value));
  }
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <input
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="w-full rounded-lg border px-2 py-1.5 text-sm tabular"
        style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" }}
      />
    </label>
  );
}
