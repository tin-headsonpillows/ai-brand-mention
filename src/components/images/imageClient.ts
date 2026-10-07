"use client";

import { zipSync } from "fflate";
import type { CropMode, Rect } from "@/lib/images/crop";
import type { ImageKind } from "@/lib/images/types";

/** An image picked for cropping/downloading, from any source. */
export interface SelectedImage {
  key: string;
  kind: ImageKind;
  /** Full-size image (remote URL or a same-origin /api path). */
  src: string;
  thumb: string;
  title: string;
  width?: number;
  height?: number;
  pageUrl?: string;
  libraryId?: string;
  /** Requested output size (AI generations), used as the crop target. */
  target?: { width: number; height: number };
}

export interface CropSettings {
  mode: CropMode;
  presetId: string;
  width: number;
  height: number;
  rect: Rect | null;
  quality: number;
  name: string;
}

/** Same-origin URL for an image, so a canvas can read its pixels (remote images go through the proxy). */
export function loadableUrl(src: string): string {
  return src.startsWith("/") ? src : `/api/images/proxy?url=${encodeURIComponent(src)}`;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load this image (the site may block downloads)"));
    img.src = loadableUrl(src);
  });
}

/**
 * Draws the selected part of an image into a canvas of the output size and encodes a JPG. Large reductions
 * are done in halving steps, which avoids the jagged result of a single big downscale. Transparent areas
 * become white (JPG has no transparency).
 */
export async function renderJpeg(
  img: HTMLImageElement,
  source: Rect,
  out: { width: number; height: number },
  quality: number
): Promise<Blob> {
  let canvas: HTMLCanvasElement | null = null;
  let srcEl: CanvasImageSource = img;
  let { x, y, w, h } = source;
  while (w / 2 >= out.width && h / 2 >= out.height) {
    const step = document.createElement("canvas");
    step.width = Math.round(w / 2);
    step.height = Math.round(h / 2);
    const sctx = step.getContext("2d")!;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(srcEl, x, y, w, h, 0, 0, step.width, step.height);
    srcEl = step;
    x = 0;
    y = 0;
    w = step.width;
    h = step.height;
  }
  canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcEl, x, y, w, h, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) =>
    canvas!.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the JPG"))), "image/jpeg", quality)
  );
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One ZIP of the given files (stored, not recompressed - JPGs are already compressed). */
export async function zipFiles(files: Array<{ name: string; blob: Blob }>): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    let name = f.name;
    for (let i = 2; entries[name]; i++) name = f.name.replace(/(\.jpg)?$/i, `-${i}.jpg`);
    entries[name] = new Uint8Array(await f.blob.arrayBuffer());
  }
  const zipped = zipSync(entries, { level: 0 });
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
}

/** Shrinks an uploaded reference image to at most `max` px (JPEG data URL) so requests stay small. */
export async function downscaleToDataUrl(file: File, max = 1536): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`${file.name} isn't an image the browser can read`));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads an exported JPG to the project's library. */
export async function saveJpegToLibrary(
  projectId: string,
  blob: Blob,
  meta: { kind: ImageKind; title: string; width: number; height: number; sourceUrl?: string; pageUrl?: string }
): Promise<boolean> {
  if (blob.size > 4 * 1024 * 1024) return false;
  const params = new URLSearchParams({
    project: projectId,
    kind: meta.kind,
    title: meta.title,
    width: String(meta.width),
    height: String(meta.height),
    ...(meta.sourceUrl ? { sourceUrl: meta.sourceUrl } : {}),
    ...(meta.pageUrl ? { pageUrl: meta.pageUrl } : {}),
  });
  const res = await fetch(`/api/images/library?${params}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
  return res.ok;
}

export function libraryFileUrl(projectId: string, id: string): string {
  return `/api/images/library/file?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`;
}
