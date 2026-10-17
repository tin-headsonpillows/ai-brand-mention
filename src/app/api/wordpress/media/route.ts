import type { NextRequest } from "next/server";
import { authorize } from "@/lib/access/store";
import { imagesIn } from "@/lib/articles/seo";
import { readArticle, saveArticles } from "@/lib/articles/store";
import type { Article } from "@/lib/articles/types";
import { parseLibraryFileUrl, readLibraryFile } from "@/lib/images/library";
import { fetchPublicImage } from "@/lib/images/safeFetch";
import { getMedia, isOnSite, listMedia, uploadMedia, type WpMedia } from "@/lib/wordpress/client";
import { readCredentials } from "@/lib/wordpress/store";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 300;

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** Vercel functions accept request bodies up to 4.5 MB; the browser shrinks bigger photos before uploading. */
const MAX_UPLOAD = 4_400_000;

async function context(projectId: string | null, need: "viewer" | "editor") {
  if (!projectId) return { error: Response.json({ error: "Unknown project" }, { status: 404 }) };
  const auth = await authorize(projectId, need);
  if (!auth.ok) return { error: auth.response };
  const credentials = await readCredentials(projectId);
  if (!credentials) return { error: Response.json({ error: "Connect this project's WordPress site first (Settings)." }, { status: 400 }) };
  return { credentials, auth };
}

const fail = (err: unknown) => Response.json({ error: err instanceof Error ? err.message : "WordPress request failed" }, { status: 502 });

/** The site's media library (newest first, searchable), or one item with its sizes (`id`). */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  const ctx = await context(projectId, "viewer");
  if (ctx.error) return ctx.error;
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (id > 0) return Response.json({ media: await getMedia(ctx.credentials, id) });
    return Response.json(await listMedia(ctx.credentials, req.nextUrl.searchParams.get("search") ?? "", Number(req.nextUrl.searchParams.get("page")) || 1));
  } catch (err) {
    return fail(err);
  }
}

/** HTML for an image already in WordPress, sized like WordPress does it (srcset comes from the wp-image class). */
function wpImageTag(media: WpMedia, alt: string, size = "large"): string {
  const s = media.sizes.find((x) => x.name === size) ?? media.sizes.find((x) => x.name === "full")!;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<img src="${esc(s.url)}" alt="${esc(alt)}" width="${s.width}" height="${s.height}" class="size-${s.name} wp-image-${media.id}">`;
}

/**
 * Uploads to the site's media library and returns the media item (its links per size):
 * - a file (multipart form: project, file, alt, title)
 * - an image already used here (JSON: project, src, alt)
 * - every image of an article that isn't on the site yet (JSON: project, articleId, action "uploadAll"), which
 *   then points the article at the WordPress copies.
 */
export async function POST(req: NextRequest) {
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const projectId = await resolveProject(String(form?.get("project") ?? "") || null);
    const ctx = await context(projectId, "editor");
    if (ctx.error) return ctx.error;
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose an image file." }, { status: 400 });
    if (!TYPES.includes(file.type)) return Response.json({ error: "Upload a JPG, PNG, WebP or GIF image." }, { status: 400 });
    if (file.size > MAX_UPLOAD) return Response.json({ error: "That file is over 4.4 MB." }, { status: 413 });
    const alt = String(form?.get("alt") ?? "").slice(0, 300);
    try {
      const media = await uploadMedia(ctx.credentials, new Uint8Array(await file.arrayBuffer()), file.type, {
        alt,
        title: String(form?.get("title") ?? "").slice(0, 200) || alt || file.name.replace(/\.\w+$/, ""),
        fileBase: file.name.replace(/\.\w+$/, ""),
      });
      return Response.json({ media });
    } catch (err) {
      return fail(err);
    }
  }

  const body = (await req.json().catch(() => null)) as { project?: unknown; src?: unknown; alt?: unknown; articleId?: unknown; action?: unknown; size?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  const ctx = await context(projectId, "editor");
  if (ctx.error) return ctx.error;
  const c = ctx.credentials;
  const bytesOf = async (src: string) => {
    const lib = parseLibraryFileUrl(src);
    if (lib) {
      const f = await readLibraryFile(lib.projectId, lib.id);
      if (!f) throw new Error("Image is no longer in the library");
      return { data: f.data, contentType: f.item.contentType };
    }
    return fetchPublicImage(src);
  };

  if (body?.action === "uploadAll") {
    const article = await readArticle(projectId!, typeof body.articleId === "string" ? body.articleId : "");
    if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
    const size = typeof body.size === "string" && /^[\w-]{1,40}$/.test(body.size) ? body.size : "large";
    let html = article.contentHtml;
    const uploaded: Array<{ src: string; url: string; id: number }> = [];
    const failed: Array<{ src: string; error: string }> = [];
    const wpMedia = { ...(article.wpMedia ?? {}) };
    let n = 0;
    for (const image of imagesIn(article.contentHtml)) {
      if (!image.src || image.src.startsWith("data:") || isOnSite(c, image.src)) continue;
      try {
        const cached = wpMedia[image.src];
        const media =
          cached && cached.siteUrl === c.siteUrl
            ? await getMedia(c, cached.id)
            : await (async () => {
                const { data, contentType } = await bytesOf(image.src);
                return uploadMedia(c, data, contentType, { alt: image.alt, title: image.alt || article.title, fileBase: `${article.slug || "image"}-${++n}` });
              })();
        wpMedia[image.src] = { id: media.id, url: media.url, siteUrl: c.siteUrl };
        // Replace the whole tag, keeping a size the editor set, so the image gets WordPress's classes and sizes.
        const escaped = image.src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "(?:&|&amp;)");
        html = html.replace(new RegExp(`<img[^>]*\\ssrc="${escaped}"[^>]*>`, "g"), (tag) => {
          const align = tag.match(/class="[^"]*\b(align(?:none|left|center|right))\b/)?.[1];
          const fresh = wpImageTag(media, image.alt, size);
          const width = tag.match(/\swidth="(\d+)"/)?.[1];
          const height = tag.match(/\sheight="(\d+)"/)?.[1];
          let out = fresh;
          if (width && height) out = out.replace(/ width="\d+" height="\d+"/, ` width="${width}" height="${height}"`);
          if (align) out = out.replace('class="', `class="${align} `);
          return out;
        });
        uploaded.push({ src: image.src, url: media.url, id: media.id });
      } catch (err) {
        failed.push({ src: image.src, error: err instanceof Error ? err.message : "Upload failed" });
      }
    }
    const next: Article = { ...article, contentHtml: html, wpMedia, updatedAt: new Date().toISOString(), updatedBy: ctx.auth.viewer.email ?? article.updatedBy };
    if (uploaded.length) await saveArticles(projectId!, [next]);
    return Response.json({ article: uploaded.length ? next : article, uploaded, failed });
  }

  const src = typeof body?.src === "string" ? body.src : "";
  if (!src) return Response.json({ error: "Nothing to upload" }, { status: 400 });
  try {
    const { data, contentType } = await bytesOf(src);
    const alt = typeof body?.alt === "string" ? body.alt.slice(0, 300) : "";
    return Response.json({ media: await uploadMedia(c, data, contentType, { alt, title: alt || "Image", fileBase: alt || "image" }) });
  } catch (err) {
    return fail(err);
  }
}
