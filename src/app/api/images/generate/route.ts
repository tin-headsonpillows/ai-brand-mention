import type { NextRequest } from "next/server";
import { MAX_REFERENCES, MAX_VARIATIONS, generateImages, type Reference } from "@/lib/images/generate";
import { saveToLibrary } from "@/lib/images/library";
import { resolveProject } from "@/lib/tracking/store";
import type { GenerateQuality } from "@/lib/images/types";

export const maxDuration = 300;

const QUALITIES: GenerateQuality[] = ["low", "medium", "high"];

/** Generates images with OpenAI's image model and saves each to the project's library. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    project?: unknown;
    prompt?: unknown;
    width?: unknown;
    height?: unknown;
    quality?: unknown;
    n?: unknown;
    references?: unknown;
  } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
  if (!prompt) return Response.json({ error: "Describe the image you want" }, { status: 400 });
  const width = Math.round(Number(body?.width));
  const height = Math.round(Number(body?.height));
  if (!(width >= 64 && width <= 6000 && height >= 64 && height <= 6000)) {
    return Response.json({ error: "Width and height must be between 64 and 6000 px" }, { status: 400 });
  }
  const quality = QUALITIES.includes(body?.quality as GenerateQuality) ? (body?.quality as GenerateQuality) : "medium";
  const n = Math.max(1, Math.min(MAX_VARIATIONS, Math.round(Number(body?.n) || 1)));
  const references: Reference[] = (Array.isArray(body?.references) ? body.references : [])
    .slice(0, MAX_REFERENCES)
    .map((r): Reference => {
      const ref = (r ?? {}) as { dataUrl?: unknown; url?: unknown };
      return {
        dataUrl: typeof ref.dataUrl === "string" ? ref.dataUrl : undefined,
        url: typeof ref.url === "string" ? ref.url.trim() : undefined,
      };
    })
    .filter((r) => r.dataUrl || r.url);

  try {
    const images = await generateImages({ prompt, width, height, quality, n, references });
    const saved = [];
    for (const image of images) {
      saved.push(
        await saveToLibrary(
          projectId,
          {
            kind: "generated",
            title: prompt.slice(0, 120),
            width: image.width,
            height: image.height,
            contentType: image.contentType,
            prompt,
          },
          image.data
        )
      );
    }
    return Response.json({ items: saved, target: { width, height } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed";
    return Response.json({ error: `Image generation failed: ${message}` }, { status: 502 });
  }
}
