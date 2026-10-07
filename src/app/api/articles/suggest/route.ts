import type { NextRequest } from "next/server";
import { readArticle } from "@/lib/articles/store";
import { suggestSeo } from "@/lib/articles/suggest";
import type { Article } from "@/lib/articles/types";
import { listCategories } from "@/lib/wordpress/client";
import { readCredentials } from "@/lib/wordpress/store";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 120;

/**
 * ChatGPT suggestions for the article as currently edited (the browser sends its unsaved fields, so
 * suggestions match what's on screen). Uses the WordPress site's categories when connected.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; id?: unknown; draft?: Partial<Article> } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const saved = await readArticle(projectId, typeof body?.id === "string" ? body.id : "");
  if (!saved) return Response.json({ error: "Article not found" }, { status: 404 });
  const d = body?.draft ?? {};
  const pick = <K extends keyof Article>(key: K, ok: (v: unknown) => boolean): Article[K] => (ok(d[key]) ? (d[key] as Article[K]) : saved[key]);
  const isStr = (v: unknown) => typeof v === "string";
  const article: Article = {
    ...saved,
    title: pick("title", isStr),
    focusKeyword: pick("focusKeyword", isStr),
    metaTitle: pick("metaTitle", isStr),
    metaDescription: pick("metaDescription", isStr),
    slug: pick("slug", isStr),
    contentHtml: typeof d.contentHtml === "string" ? d.contentHtml.slice(0, 500_000) : saved.contentHtml,
    secondaryKeywords: Array.isArray(d.secondaryKeywords) ? d.secondaryKeywords.filter(isStr) : saved.secondaryKeywords,
    featuredImage: d.featuredImage === null ? undefined : (d.featuredImage as Article["featuredImage"]) ?? saved.featuredImage,
  };

  const credentials = await readCredentials(projectId);
  const categories = credentials ? await listCategories(credentials).then((c) => c.map((x) => x.name)).catch(() => []) : [];
  const siteHost = credentials ? new URL(credentials.siteUrl).hostname : undefined;
  try {
    return Response.json({ suggestions: await suggestSeo(article, { siteHost, categories }) });
  } catch (err) {
    return Response.json({ error: `ChatGPT suggestions failed: ${err instanceof Error ? err.message : "unknown error"}` }, { status: 502 });
  }
}
