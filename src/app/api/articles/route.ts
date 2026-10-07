import type { NextRequest } from "next/server";
import { blankArticle, listArticles, saveArticles } from "@/lib/articles/store";
import { resolveProject } from "@/lib/tracking/store";

/** The project's articles (summaries for the list). */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  return Response.json({ items: await listArticles(projectId) });
}

/** A new blank article. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; title?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const article = blankArticle({ title: typeof body?.title === "string" ? body.title.trim().slice(0, 300) : "" });
  await saveArticles(projectId, [article]);
  return Response.json({ article });
}
