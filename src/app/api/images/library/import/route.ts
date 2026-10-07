import type { NextRequest } from "next/server";
import { imageSize } from "@/lib/images/imageSize";
import { listLibrary, saveManyToLibrary } from "@/lib/images/library";
import { mockSvg } from "@/lib/images/mockSvg";
import { fetchPublicImage } from "@/lib/images/safeFetch";
import { isImagesMock } from "@/lib/images/search";
import { resolveProject } from "@/lib/tracking/store";
import type { LibraryItem } from "@/lib/images/types";

export const maxDuration = 300;

const MAX_ITEMS = 30;
const RASTER = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface ImportRequest {
  url: string;
  kind: "google" | "instagram" | "web";
  title: string;
  pageUrl?: string;
}

const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v.slice(0, 2000) : undefined);

/**
 * Saves Google / Instagram results to the project's library at their original size and format, fetched on the
 * server (no SerpApi credits). Images already in the library (same source URL) are skipped.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; images?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });

  const mock = isImagesMock();
  const requests: ImportRequest[] = (Array.isArray(body?.images) ? body.images : [])
    .slice(0, MAX_ITEMS)
    .map((raw): ImportRequest | null => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const url = httpUrl(r.url) ?? (mock && typeof r.url === "string" && r.url.startsWith("/api/images/mock?") ? r.url : undefined);
      if (!url) return null;
      return {
        url,
        kind: r.kind === "instagram" ? "instagram" : r.kind === "web" ? "web" : "google",
        title: typeof r.title === "string" ? r.title.slice(0, 200) : "",
        pageUrl: httpUrl(r.pageUrl),
      };
    })
    .filter((r): r is ImportRequest => r !== null);
  if (requests.length === 0) return Response.json({ error: "No images to save" }, { status: 400 });

  const existing = new Map((await listLibrary(projectId)).filter((i) => i.sourceUrl).map((i) => [i.sourceUrl!, i]));
  const already: LibraryItem[] = [];
  const failed: Array<{ url: string; error: string }> = [];
  const entries: Parameters<typeof saveManyToLibrary>[1] = [];
  const seen = new Set<string>();

  const todo = requests.filter((r) => {
    const hit = existing.get(r.url);
    if (hit) already.push(hit);
    if (hit || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // A few downloads at a time; each is bounded by fetchPublicImage's 20 s / 20 MB limits.
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const r = todo[next++];
      try {
        const { data, contentType } = r.url.startsWith("/") ? mockImage(r.url) : await fetchPublicImage(r.url);
        if (!RASTER.has(contentType) && !(mock && contentType === "image/svg+xml")) {
          throw new Error(`Unsupported image type (${contentType})`);
        }
        const size = imageSize(data) ?? (r.url.startsWith("/") ? mockImage(r.url) : null);
        entries.push({
          meta: {
            kind: r.kind,
            title: r.title || (r.kind === "instagram" ? "Instagram post" : r.kind === "web" ? "Web image" : "Google image"),
            width: size?.width ?? 0,
            height: size?.height ?? 0,
            contentType,
            sourceUrl: r.url,
            pageUrl: r.pageUrl,
          },
          data,
        });
      } catch (err) {
        failed.push({ url: r.url, error: err instanceof Error ? err.message : "Couldn't download" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));

  const saved = await saveManyToLibrary(projectId, entries);
  return Response.json({ saved, already, failed });
}

/** Mock-mode placeholders (only accepted when no SerpApi key is configured). */
function mockImage(url: string): { data: Uint8Array; contentType: string; width: number; height: number } {
  const { svg, width, height } = mockSvg(new URLSearchParams(url.split("?")[1] ?? ""));
  return { data: new TextEncoder().encode(svg), contentType: "image/svg+xml", width, height };
}
