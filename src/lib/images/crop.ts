/** Crop / resize geometry for the image studio. All rectangles are in source-image pixels. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * crop: exact output size, cut from a box of the same shape (never stretched).
 * resize: whole image scaled to a width, height follows the original proportions.
 * original: whole image at its own size, just converted to JPG.
 */
export type CropMode = "crop" | "resize" | "original";

export const SIZE_PRESETS: Array<{ id: string; label: string; width: number; height: number }> = [
  { id: "square", label: "Square 1080 × 1080 (Instagram)", width: 1080, height: 1080 },
  { id: "portrait", label: "Portrait 1080 × 1350 (Instagram 4:5)", width: 1080, height: 1350 },
  { id: "story", label: "Story 1080 × 1920 (9:16)", width: 1080, height: 1920 },
  { id: "og", label: "Link preview 1200 × 630 (Facebook / OG)", width: 1200, height: 630 },
  { id: "hd", label: "Full HD 1920 × 1080 (16:9)", width: 1920, height: 1080 },
  { id: "blog", label: "Blog 1600 × 900 (16:9)", width: 1600, height: 900 },
  { id: "photo", label: "Photo 1500 × 1000 (3:2)", width: 1500, height: 1000 },
  { id: "banner", label: "Banner 1920 × 600", width: 1920, height: 600 },
];

/** The largest box with the target's shape, centred in the image. */
export function centeredRect(imageW: number, imageH: number, targetW: number, targetH: number): Rect {
  const aspect = targetW / targetH;
  let w = imageW;
  let h = w / aspect;
  if (h > imageH) {
    h = imageH;
    w = h * aspect;
  }
  return { x: (imageW - w) / 2, y: (imageH - h) / 2, w, h };
}

/** Keeps a box inside the image (moving it, never resizing). */
export function clampRect(r: Rect, imageW: number, imageH: number): Rect {
  const w = Math.min(r.w, imageW);
  const h = Math.min(r.h, imageH);
  return { x: Math.max(0, Math.min(imageW - w, r.x)), y: Math.max(0, Math.min(imageH - h, r.y)), w, h };
}

/**
 * Resizes a box from a corner while keeping its shape: `anchor` is the opposite (fixed) corner and `pointer`
 * where the dragged corner is now. The result stays inside the image and at least `minW` wide.
 */
export function resizeFromCorner(
  anchor: { x: number; y: number },
  pointer: { x: number; y: number },
  aspect: number,
  imageW: number,
  imageH: number,
  minW = 24
): Rect {
  const dirX = pointer.x >= anchor.x ? 1 : -1;
  const dirY = pointer.y >= anchor.y ? 1 : -1;
  // Room available from the anchor towards the drag direction.
  const maxW = Math.min(dirX > 0 ? imageW - anchor.x : anchor.x, (dirY > 0 ? imageH - anchor.y : anchor.y) * aspect);
  let w = Math.max(Math.abs(pointer.x - anchor.x), Math.abs(pointer.y - anchor.y) * aspect);
  w = Math.max(Math.min(minW, maxW), Math.min(w, maxW));
  const h = w / aspect;
  return { x: dirX > 0 ? anchor.x : anchor.x - w, y: dirY > 0 ? anchor.y : anchor.y - h, w, h };
}

/** Output pixel size for a mode. */
export function outputSize(
  mode: CropMode,
  imageW: number,
  imageH: number,
  target: { width: number; height: number }
): { width: number; height: number } {
  if (mode === "original") return { width: imageW, height: imageH };
  if (mode === "resize") return { width: target.width, height: Math.max(1, Math.round((target.width * imageH) / imageW)) };
  return { width: target.width, height: target.height };
}

/** How much the export enlarges the source pixels (above ~1.3 the result starts to look soft). */
export function upscaleFactor(mode: CropMode, rect: Rect, imageW: number, out: { width: number }): number {
  const sourceW = mode === "crop" ? rect.w : imageW;
  return out.width / sourceW;
}

export function safeFileName(name: string, fallback = "image"): string {
  const cleaned = name
    .replace(/[Đđ]/g, "d")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}
