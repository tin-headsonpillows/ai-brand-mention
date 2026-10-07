import { toFile } from "openai";
import { getOpenAIClient, isMockMode } from "../openai";
import { fetchPublicImage } from "./safeFetch";
import type { GenerateQuality } from "./types";

/** OpenAI's image model; override with OPENAI_IMAGE_MODEL when a newer one is available on the account. */
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
export const MAX_REFERENCES = 4;
export const MAX_VARIATIONS = 4;

type ModelSize = "1024x1024" | "1536x1024" | "1024x1536";

/**
 * The model renders at one of three sizes; pick the one whose shape is closest to the requested size. The
 * browser then crops/resizes to the exact pixels asked for, so nothing is ever stretched.
 */
export function modelSize(width: number, height: number): ModelSize {
  const ratio = width / height;
  if (ratio >= 1.2) return "1536x1024";
  if (ratio <= 1 / 1.2) return "1024x1536";
  return "1024x1024";
}

export interface Reference {
  /** data:image/...;base64,... from an upload (downscaled in the browser). */
  dataUrl?: string;
  /** Public image link. */
  url?: string;
}

async function referenceFile(ref: Reference, index: number) {
  if (ref.dataUrl) {
    const match = ref.dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
    if (!match) throw new Error(`Reference image ${index + 1} isn't a valid image`);
    const ext = match[1].split("/")[1].replace("jpeg", "jpg").replace(/\+.*$/, "");
    return toFile(Buffer.from(match[2], "base64"), `reference-${index + 1}.${ext}`, { type: match[1] });
  }
  if (ref.url) {
    const { data, contentType } = await fetchPublicImage(ref.url);
    const ext = contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    return toFile(Buffer.from(data), `reference-${index + 1}.${ext}`, { type: contentType });
  }
  throw new Error(`Reference image ${index + 1} is empty`);
}

export interface GeneratedImage {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

/**
 * Generates `n` images from a prompt, guided by reference images when given (the edit endpoint takes them
 * as visual input). Returns JPEGs at the model size closest to the requested shape.
 */
export async function generateImages(input: {
  prompt: string;
  width: number;
  height: number;
  quality: GenerateQuality;
  n: number;
  references: Reference[];
}): Promise<GeneratedImage[]> {
  const size = modelSize(input.width, input.height);
  const [w, h] = size.split("x").map(Number);
  if (isMockMode()) return mockImages(input.prompt, input.n, w, h);

  const client = getOpenAIClient();
  const common = {
    model: IMAGE_MODEL,
    prompt: input.prompt,
    size,
    quality: input.quality,
    n: input.n,
    output_format: "jpeg" as const,
    output_compression: 92,
  };
  const response = input.references.length
    ? await client.images.edit({
        ...common,
        image: await Promise.all(input.references.slice(0, MAX_REFERENCES).map(referenceFile)),
      })
    : await client.images.generate(common);

  return (response.data ?? [])
    .map((item) => item.b64_json)
    .filter((b64): b64 is string => typeof b64 === "string")
    .map((b64) => ({ data: new Uint8Array(Buffer.from(b64, "base64")), contentType: "image/jpeg", width: w, height: h }));
}

/** Placeholder artwork when no OpenAI key is configured, so the flow stays testable. */
function mockImages(prompt: string, n: number, w: number, h: number): GeneratedImage[] {
  return Array.from({ length: n }, (_, i) => {
    const hue = (prompt.length * 37 + i * 71) % 360;
    const label = prompt.slice(0, 48).replace(/[<>&"]/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,35%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="${Math.round(w / 24)}" text-anchor="middle">Mock ${i + 1}: ${label}</text></svg>`;
    return { data: new TextEncoder().encode(svg), contentType: "image/svg+xml", width: w, height: h };
  });
}
