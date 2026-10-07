import type { NextRequest } from "next/server";
import { readArticle, saveArticles } from "@/lib/articles/store";
import type { Article } from "@/lib/articles/types";
import { publishArticle, testConnection } from "@/lib/wordpress/client";
import { readCredentials, readSettings, saveTest } from "@/lib/wordpress/store";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 300;

/** Sends the saved article to the project's WordPress as a draft, a live post or a scheduled post. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; id?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const article = await readArticle(projectId, typeof body?.id === "string" ? body.id : "");
  if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
  const credentials = await readCredentials(projectId);
  if (!credentials) return Response.json({ error: "Connect this project's WordPress site first (Settings)" }, { status: 400 });
  if (!article.title.trim()) return Response.json({ error: "Add a title before publishing" }, { status: 400 });

  // Whether the SEO meta helper is active decides if SEO fields are sent; test once if never tested.
  let test = (await readSettings(projectId))?.lastTest;
  if (!test?.ok) {
    test = await testConnection(credentials);
    await saveTest(projectId, test);
    if (!test.ok) return Response.json({ error: test.message }, { status: 400 });
  }

  try {
    const result = await publishArticle(credentials, article, Boolean(test.helper));
    const status: Article["status"] = result.wordpress.status === "publish" ? "published" : result.wordpress.status === "future" ? "scheduled" : article.status === "error" ? "ready" : article.status;
    const next: Article = { ...article, wordpress: result.wordpress, wpMedia: result.wpMedia, status, lastError: undefined, updatedAt: new Date().toISOString() };
    await saveArticles(projectId, [next]);
    return Response.json({ article: next, warnings: result.warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publishing failed";
    await saveArticles(projectId, [{ ...article, status: "error", lastError: message, updatedAt: new Date().toISOString() }]);
    return Response.json({ error: message }, { status: 502 });
  }
}
