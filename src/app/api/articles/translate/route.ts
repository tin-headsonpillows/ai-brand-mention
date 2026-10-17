import type { NextRequest } from "next/server";
import { authorize } from "@/lib/access/store";
import { LANGUAGES } from "@/lib/articles/languages";
import { blankArticle, readArticle, saveArticles } from "@/lib/articles/store";
import { translateArticle } from "@/lib/articles/translate";
import type { Article } from "@/lib/articles/types";
import { DEFAULT_MODEL } from "@/lib/openai";
import { readConfig, resolveProject } from "@/lib/tracking/store";
import { readSettings } from "@/lib/wordpress/store";

export const maxDuration = 300;

/**
 * Translates the saved article into one language and saves it as its own article (linked both ways), ready to
 * edit and publish. Translating again updates that translation in place, keeping its WordPress post.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; id?: unknown; lang?: unknown; model?: unknown; instructions?: unknown; linkPrefix?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const auth = await authorize(projectId, "editor");
  if (!auth.ok) return auth.response;
  const source = await readArticle(projectId, typeof body?.id === "string" ? body.id : "");
  if (!source) return Response.json({ error: "Article not found" }, { status: 404 });
  const lang = typeof body?.lang === "string" ? body.lang : "";
  if (!LANGUAGES.some((l) => l.code === lang)) return Response.json({ error: "Pick a language" }, { status: 400 });
  if (source.translationOf) return Response.json({ error: "Translate the original article, not a translation." }, { status: 400 });
  if (!source.contentHtml.trim() && !source.title.trim()) return Response.json({ error: "The article is empty." }, { status: 400 });
  const model = typeof body?.model === "string" && /^[\w.-]{3,60}$/.test(body.model) ? body.model : DEFAULT_MODEL;
  const linkPrefix = typeof body?.linkPrefix === "string" ? body.linkPrefix.trim().slice(0, 40) : "";
  const wp = await readSettings(projectId).catch(() => null);
  const host = wp?.siteUrl ? new URL(wp.siteUrl).hostname : "";
  const brand = await readConfig(projectId)
    .then((c) => c.brand.name)
    .catch(() => "");

  try {
    const { fields, usage } = await translateArticle(source, {
      lang,
      model,
      instructions: typeof body?.instructions === "string" ? body.instructions : undefined,
      linkPattern: linkPrefix && host ? { host, prefix: linkPrefix } : undefined,
      brand,
    });
    const now = new Date().toISOString();
    const existingId = source.translations?.[lang];
    const existing = existingId ? await readArticle(projectId, existingId) : null;
    const base = existing ?? blankArticle({ categories: source.categories, tags: source.tags, slug: source.slug });
    const translated: Article = {
      ...base,
      title: fields.title,
      metaTitle: fields.metaTitle,
      metaDescription: fields.metaDescription,
      excerpt: fields.excerpt,
      focusKeyword: fields.focusKeyword,
      secondaryKeywords: fields.secondaryKeywords,
      contentHtml: fields.contentHtml,
      featuredImage: source.featuredImage ? { ...source.featuredImage, alt: fields.featuredAlt || source.featuredImage.alt } : base.featuredImage,
      lang,
      translationOf: { id: source.id, at: now, model, untranslated: fields.untranslated },
      source: { type: "translation", importedAt: now },
      status: existing?.status === "published" || existing?.status === "scheduled" ? existing.status : "draft",
      updatedAt: now,
      updatedBy: auth.viewer.email,
    };
    // Re-read the source: it may have been edited (autosaved) while the translation ran.
    const latest = (await readArticle(projectId, source.id)) ?? source;
    const updatedSource: Article = { ...latest, translations: { ...(latest.translations ?? {}), [lang]: translated.id } };
    await saveArticles(projectId, [translated, updatedSource]);
    return Response.json({ article: translated, usage, untranslated: fields.untranslated, segments: fields.segments });
  } catch (err) {
    return Response.json({ error: `Translation failed: ${err instanceof Error ? err.message : "unknown error"}` }, { status: 502 });
  }
}
