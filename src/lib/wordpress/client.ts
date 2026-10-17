import type { Article, WordPressLink } from "../articles/types";
import { imagesIn } from "../articles/seo";
import { parseLibraryFileUrl, readLibraryFile } from "../images/library";
import { fetchPublicImage, publicFetch } from "../images/safeFetch";
import type { SeoPlugin, WordPressCredentials, WordPressTest } from "./store";

/**
 * WordPress REST API client using an Application Password (Users -> Profile -> Application Passwords).
 * Every request goes through publicFetch, so a configured site can't point the server at internal addresses.
 */

type Json = Record<string, unknown>;
type WpError = Error & { status?: number; code?: string; data?: Json };

function auth(c: WordPressCredentials) {
  return `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}`;
}

async function wp(c: WordPressCredentials, route: string, init: RequestInit & { json?: unknown } = {}): Promise<Json & { __status: number }> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", auth(c));
  headers.set("Accept", "application/json");
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const url = `${c.siteUrl}/wp-json${route}`;
  const res = await publicFetch(url, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body }, 60_000);
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    if (!res.ok) throw new Error(`WordPress answered ${res.status} (not the REST API - is ${c.siteUrl}/wp-json reachable?)`);
    data = {};
  }
  const body = (Array.isArray(data) ? { items: data } : (data as Json)) ?? {};
  if (!res.ok) {
    const message = typeof body.message === "string" ? body.message.replace(/<[^>]+>/g, "") : `HTTP ${res.status}`;
    const error = new Error(`WordPress: ${message}`) as WpError;
    error.status = res.status;
    error.code = typeof body.code === "string" ? body.code : undefined;
    error.data = (body.data ?? {}) as Json;
    throw error;
  }
  return Object.assign(body, { __status: res.status });
}

/** Checks the login and what the site offers (SEO plugins, our helper plugin). */
export async function testConnection(c: WordPressCredentials): Promise<WordPressTest> {
  const at = new Date().toISOString();
  try {
    const root = await publicFetch(`${c.siteUrl}/wp-json/`, { headers: { Accept: "application/json" } }, 20_000);
    if (!root.ok) return { ok: false, at, message: `The REST API isn't reachable at ${c.siteUrl}/wp-json (HTTP ${root.status}).` };
    const info = (await root.json().catch(() => ({}))) as { namespaces?: string[]; name?: string };
    const namespaces = info.namespaces ?? [];
    const detected: SeoPlugin[] = [];
    if (namespaces.some((n) => n.startsWith("yoast/"))) detected.push("yoast");
    if (namespaces.some((n) => n.startsWith("rankmath/"))) detected.push("rankmath");
    const helper = namespaces.includes("abmt/v1");
    const me = await wp(c, "/wp/v2/users/me?context=edit");
    const caps = (me.capabilities ?? {}) as Record<string, boolean>;
    const canPublish = Boolean(caps.publish_posts);
    const canUpload = Boolean(caps.upload_files);
    const problems = [
      !canPublish ? "this user can't publish posts" : "",
      !canUpload ? "this user can't upload images" : "",
      c.seoPlugin !== "none" && !helper ? "the SEO meta helper plugin isn't active (SEO title/description won't be sent)" : "",
      c.seoPlugin !== "none" && !detected.includes(c.seoPlugin) ? `${c.seoPlugin === "yoast" ? "Yoast SEO" : "Rank Math"} wasn't detected on the site` : "",
    ].filter(Boolean);
    return {
      ok: true,
      at,
      user: String(me.name ?? c.username),
      canPublish,
      canUpload,
      detected,
      helper,
      message: `Connected to ${info.name ?? c.siteUrl} as ${String(me.name ?? c.username)}.${problems.length ? ` Note: ${problems.join("; ")}.` : ""}`,
    };
  } catch (err) {
    const e = err as WpError;
    const hint = e.status === 401 ? " Check the username and application password (not the normal login password)." : "";
    return { ok: false, at, message: `${e.message}${hint}` };
  }
}

export async function listCategories(c: WordPressCredentials): Promise<Array<{ id: number; name: string }>> {
  const res = await wp(c, "/wp/v2/categories?per_page=100&_fields=id,name&orderby=count&order=desc");
  return ((res.items as Json[]) ?? []).map((t) => ({ id: Number(t.id), name: decode(String(t.name)) }));
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');

/** Term ids for names, creating the missing ones (categories need the manage_categories capability). */
async function termIds(c: WordPressCredentials, taxonomy: "categories" | "tags", names: string[]): Promise<{ ids: number[]; warnings: string[] }> {
  const ids: number[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const found = await wp(c, `/wp/v2/${taxonomy}?search=${encodeURIComponent(name)}&per_page=20&_fields=id,name`);
    const match = ((found.items as Json[]) ?? []).find((t) => decode(String(t.name)).toLowerCase() === name.toLowerCase());
    if (match) {
      ids.push(Number(match.id));
      continue;
    }
    try {
      const created = await wp(c, `/wp/v2/${taxonomy}`, { method: "POST", json: { name } });
      ids.push(Number(created.id));
    } catch (err) {
      const e = err as WpError;
      // "term_exists" carries the id of the term that's already there (e.g. same slug, different name).
      const existing = e.code === "term_exists" ? Number(e.data?.term_id) : NaN;
      if (Number.isFinite(existing) && existing > 0) ids.push(existing);
      else warnings.push(`Couldn't add ${taxonomy === "tags" ? "tag" : "category"} "${name}": ${e.message}`);
    }
  }
  return { ids, warnings };
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function imageBytes(src: string): Promise<{ data: Uint8Array; contentType: string }> {
  const lib = parseLibraryFileUrl(src);
  if (lib) {
    const file = await readLibraryFile(lib.projectId, lib.id);
    if (!file) throw new Error("Image is no longer in the library");
    return { data: file.data, contentType: file.item.contentType };
  }
  return fetchPublicImage(src);
}

/** A WordPress media item with the sizes WordPress generated (thumbnail, medium, large... and full). */
export interface WpMedia {
  id: number;
  url: string;
  alt: string;
  title: string;
  width: number;
  height: number;
  sizes: Array<{ name: string; url: string; width: number; height: number }>;
}

function toMedia(m: Json): WpMedia {
  const details = (m.media_details ?? {}) as Json;
  const sizes = Object.entries((details.sizes ?? {}) as Record<string, Json>)
    .map(([name, v]) => ({ name, url: String(v.source_url ?? ""), width: Number(v.width ?? 0), height: Number(v.height ?? 0) }))
    .filter((v) => v.url)
    .sort((a, b) => a.width - b.width);
  const url = String(m.source_url ?? "");
  const width = Number(details.width ?? 0);
  const height = Number(details.height ?? 0);
  if (!sizes.some((x) => x.name === "full")) sizes.push({ name: "full", url, width, height });
  const title = (m.title ?? {}) as Json;
  return { id: Number(m.id), url, alt: String(m.alt_text ?? ""), title: decode(String(title.rendered ?? title.raw ?? "")), width, height, sizes };
}

const MEDIA_FIELDS = "id,source_url,alt_text,title,media_details";

/** Uploads image bytes to the media library (with alt text and title). */
export async function uploadMedia(c: WordPressCredentials, data: Uint8Array, contentType: string, meta: { alt: string; title: string; fileBase: string }): Promise<WpMedia> {
  const ext = EXT[contentType];
  if (!ext) throw new Error(`WordPress doesn't accept ${contentType} images`);
  const safeBase = meta.fileBase.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
  const media = await wp(c, `/wp/v2/media?_fields=${MEDIA_FIELDS}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${safeBase}.${ext}"` },
    body: Buffer.from(data),
  });
  const id = Number(media.id);
  if (meta.alt || meta.title) {
    const updated = await wp(c, `/wp/v2/media/${id}?_fields=${MEDIA_FIELDS}`, { method: "POST", json: { alt_text: meta.alt, title: meta.title || meta.alt } }).catch(() => null);
    // Alt text is a nice-to-have; the upload itself worked.
    if (updated) return toMedia(updated);
  }
  return toMedia(media);
}

export async function listMedia(c: WordPressCredentials, search: string, page: number): Promise<{ items: WpMedia[]; more: boolean }> {
  const q = new URLSearchParams({ media_type: "image", per_page: "30", page: String(Math.max(1, page)), _fields: MEDIA_FIELDS, orderby: "date", order: "desc" });
  if (search.trim()) q.set("search", search.trim());
  const res = await wp(c, `/wp/v2/media?${q}`);
  const items = ((res.items as Json[]) ?? []).map(toMedia);
  return { items, more: items.length === 30 };
}

export async function getMedia(c: WordPressCredentials, id: number): Promise<WpMedia> {
  return toMedia(await wp(c, `/wp/v2/media/${id}?_fields=${MEDIA_FIELDS}`));
}

/** Whether an image is already on the WordPress site (so publishing doesn't upload it again). */
export function isOnSite(c: WordPressCredentials, src: string): boolean {
  try {
    const host = (h: string) => h.replace(/^www\./, "").toLowerCase();
    return host(new URL(src).hostname) === host(new URL(c.siteUrl).hostname);
  } catch {
    return false;
  }
}

async function uploadImage(c: WordPressCredentials, src: string, meta: { alt: string; title: string; fileBase: string }) {
  const { data, contentType } = await imageBytes(src);
  const media = await uploadMedia(c, data, contentType, meta);
  return { id: media.id, url: media.url };
}

function seoMeta(plugin: SeoPlugin, article: Article): Record<string, string> {
  const title = article.metaTitle.trim();
  const description = article.metaDescription.trim();
  if (plugin === "yoast") {
    return { _yoast_wpseo_title: title, _yoast_wpseo_metadesc: description, _yoast_wpseo_focuskw: article.focusKeyword.trim() };
  }
  if (plugin === "rankmath") {
    // Rank Math takes the focus keyword first, then extra keywords, comma-separated.
    const keywords = [article.focusKeyword, ...article.secondaryKeywords].map((k) => k.trim()).filter(Boolean).join(",");
    return { rank_math_title: title, rank_math_description: description, rank_math_focus_keyword: keywords };
  }
  return {};
}

export interface PublishResult {
  wordpress: WordPressLink;
  wpMedia: NonNullable<Article["wpMedia"]>;
  warnings: string[];
}

/**
 * Uploads the article's images (once per site), then creates or updates the post with title, slug, content,
 * excerpt, categories, tags, featured image, SEO meta and the chosen status (draft / publish / scheduled).
 */
export async function publishArticle(c: WordPressCredentials, article: Article, helperActive: boolean): Promise<PublishResult> {
  const warnings: string[] = [];
  const wpMedia = { ...(article.wpMedia ?? {}) };
  const slug = article.slug || "image";
  let n = 0;
  const ensureMedia = async (src: string, alt: string, wpId?: number) => {
    // Already in this site's media library (picked or uploaded from the editor).
    if (wpId && isOnSite(c, src)) return { id: wpId, url: src, siteUrl: c.siteUrl };
    const cached = wpMedia[src];
    if (cached && cached.siteUrl === c.siteUrl) return cached;
    n++;
    const uploaded = await uploadImage(c, src, { alt, title: alt || article.title, fileBase: `${slug}-${n}`.slice(0, 80) });
    wpMedia[src] = { ...uploaded, siteUrl: c.siteUrl };
    return wpMedia[src];
  };

  let content = article.contentHtml;
  for (const image of imagesIn(article.contentHtml)) {
    if (!image.src || image.src.startsWith("data:") || isOnSite(c, image.src)) continue;
    try {
      const media = await ensureMedia(image.src, image.alt);
      const escaped = image.src.replace(/&/g, "&amp;");
      content = content.split(`src="${escaped}"`).join(`src="${media.url}"`).split(`src="${image.src}"`).join(`src="${media.url}"`);
    } catch (err) {
      warnings.push(`Image not uploaded (${image.alt || image.src.slice(0, 60)}): ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  let featuredMedia: number | undefined;
  if (article.featuredImage) {
    try {
      featuredMedia = (await ensureMedia(article.featuredImage.src, article.featuredImage.alt, article.featuredImage.wpId)).id;
    } catch (err) {
      warnings.push(`Featured image not uploaded: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  const categories = await termIds(c, "categories", article.categories);
  const tags = await termIds(c, "tags", article.tags);
  warnings.push(...categories.warnings, ...tags.warnings);

  const status = article.publish.mode === "future" ? "future" : article.publish.mode === "publish" ? "publish" : "draft";
  if (status === "future") {
    if (!article.publish.date || new Date(article.publish.date).getTime() <= Date.now()) throw new Error("Pick a future date and time to schedule the post");
  }
  const meta = c.seoPlugin !== "none" ? seoMeta(c.seoPlugin, article) : {};
  if (c.seoPlugin !== "none" && !helperActive) warnings.push("SEO title, description and keyword were not sent: install and activate the SEO meta helper plugin, then test the connection again.");

  const post: Json = {
    title: article.title,
    content,
    excerpt: article.excerpt,
    slug: article.slug || undefined,
    status,
    categories: categories.ids,
    tags: tags.ids,
    ...(featuredMedia ? { featured_media: featuredMedia } : {}),
    ...(status === "future" ? { date_gmt: article.publish.date!.replace(/\.\d+Z$/, "").replace(/Z$/, "") } : {}),
    ...(helperActive && Object.keys(meta).length ? { meta } : {}),
  };

  const existing = article.wordpress && article.wordpress.siteUrl === c.siteUrl ? article.wordpress.postId : undefined;
  let saved: Json;
  try {
    saved = existing ? await wp(c, `/wp/v2/posts/${existing}`, { method: "POST", json: post }) : await wp(c, "/wp/v2/posts", { method: "POST", json: post });
  } catch (err) {
    const e = err as WpError;
    // The post was deleted in WordPress: create it again.
    if (existing && (e.status === 404 || e.status === 410)) saved = await wp(c, "/wp/v2/posts", { method: "POST", json: post });
    else throw err;
  }

  return {
    wordpress: {
      siteUrl: c.siteUrl,
      postId: Number(saved.id),
      link: typeof saved.link === "string" ? saved.link : undefined,
      status: String(saved.status ?? status),
      publishedAt: new Date().toISOString(),
    },
    wpMedia,
    warnings,
  };
}
