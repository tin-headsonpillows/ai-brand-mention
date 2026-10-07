import type { GenerateQuality } from "./types";

/**
 * OpenAI image models the generator offers, with prices from OpenAI's image-generation guide and model pages
 * (checked October 2026). Shared by the browser (cost preview) and the server (validation, actual cost).
 */
export interface ImageModelInfo {
  id: string;
  label: string;
  note: string;
  /** Draws at any size of the requested shape (multiples of 16, up to 3:1); otherwise one of three fixed sizes. */
  customSizes: boolean;
  /** USD per 1M tokens. */
  rates: { textIn: number; imageIn: number; imageOut: number };
  /** USD per image: [square 1024×1024, portrait/landscape 1024×1536]. */
  perImage: Record<GenerateQuality, [number, number]>;
  /** True when OpenAI publishes token rates only and perImage is derived from a sibling model's token counts. */
  derived?: boolean;
  deprecated?: boolean;
}

const GPT_IMAGE_2_PER_IMAGE: ImageModelInfo["perImage"] = {
  low: [0.006, 0.005],
  medium: [0.053, 0.041],
  high: [0.211, 0.165],
};

export const IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    note: "Newest. Fast, high-quality everyday images.",
    customSizes: true,
    rates: { textIn: 5, imageIn: 8, imageOut: 30 },
    perImage: GPT_IMAGE_2_PER_IMAGE,
    derived: true,
  },
  {
    id: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    note: "Newest. Most precise when following reference images.",
    customSizes: true,
    rates: { textIn: 5, imageIn: 8, imageOut: 30 },
    perImage: GPT_IMAGE_2_PER_IMAGE,
    derived: true,
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    note: "Previous flagship. Any size, high-fidelity references.",
    customSizes: true,
    rates: { textIn: 5, imageIn: 8, imageOut: 30 },
    perImage: GPT_IMAGE_2_PER_IMAGE,
  },
  {
    id: "gpt-image-1.5",
    label: "GPT Image 1.5",
    note: "Square images are cheapest. Three fixed sizes.",
    customSizes: false,
    rates: { textIn: 5, imageIn: 8, imageOut: 32 },
    perImage: { low: [0.009, 0.013], medium: [0.034, 0.05], high: [0.133, 0.2] },
  },
  {
    id: "gpt-image-1-mini",
    label: "GPT Image 1 Mini",
    note: "Cheapest. Good for drafts and simple scenes.",
    customSizes: false,
    rates: { textIn: 2, imageIn: 2.5, imageOut: 8 },
    perImage: { low: [0.005, 0.006], medium: [0.011, 0.015], high: [0.036, 0.052] },
  },
  {
    id: "gpt-image-1",
    label: "GPT Image 1",
    note: "Older model (deprecated by OpenAI). Most expensive.",
    customSizes: false,
    rates: { textIn: 5, imageIn: 10, imageOut: 40 },
    perImage: { low: [0.011, 0.016], medium: [0.042, 0.063], high: [0.167, 0.25] },
    deprecated: true,
  },
];

export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";

export function imageModel(id: string | null | undefined): ImageModelInfo | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

const roundTo16 = (v: number) => Math.max(16, Math.round(v / 16) * 16);

/**
 * The size the model draws at for a requested output size. Fixed-size models get the closest of
 * 1024×1024 / 1536×1024 / 1024×1536. Custom-size models get the exact shape at about the same pixel count as
 * those (so the price matches OpenAI's per-image table); the browser then resizes to the exact pixels.
 */
export function drawSize(model: ImageModelInfo, width: number, height: number): { width: number; height: number; square: boolean } {
  const ratio = width / height;
  if (!model.customSizes) {
    if (ratio >= 1.2) return { width: 1536, height: 1024, square: false };
    if (ratio <= 1 / 1.2) return { width: 1024, height: 1536, square: false };
    return { width: 1024, height: 1024, square: true };
  }
  const r = Math.min(3, Math.max(1 / 3, ratio));
  if (Math.abs(r - 1) < 0.05) return { width: 1024, height: 1024, square: true };
  const area = 1024 * 1536;
  let w = roundTo16(Math.sqrt(area * r));
  let h = roundTo16(w / r);
  // Rounding can tip the shape past OpenAI's 3:1 limit.
  while (w / h > 3) w -= 16;
  while (h / w > 3) h -= 16;
  return { width: w, height: h, square: false };
}

/** Pre-generation estimate: image output from the per-image table plus prompt text (~4 characters per token). */
export function estimateCost(
  model: ImageModelInfo,
  quality: GenerateQuality,
  width: number,
  height: number,
  n: number,
  promptChars: number
): number {
  const { square } = drawSize(model, width, height);
  const perImage = model.perImage[quality][square ? 0 : 1];
  const promptTokens = Math.ceil(promptChars / 4) + 20;
  return n * perImage + (promptTokens * model.rates.textIn) / 1_000_000;
}

export interface ImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
}

/** What OpenAI charges for one request, from the token usage it returns. */
export function usageCost(model: ImageModelInfo, usage: ImageUsage): number {
  const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
  const textIn = usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - imageIn);
  const out = usage.output_tokens ?? 0;
  return (textIn * model.rates.textIn + imageIn * model.rates.imageIn + out * model.rates.imageOut) / 1_000_000;
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.1) return `$${Number(value.toFixed(3))}`;
  return `$${value.toFixed(2)}`;
}
