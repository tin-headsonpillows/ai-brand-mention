import type { NextRequest } from "next/server";
import { authorize } from "@/lib/access/store";
import { readArticle } from "@/lib/articles/store";
import { actOnReview, readReview, type ReviewAction } from "@/lib/articles/review";
import { GoogleAccessError } from "@/lib/google/oauth";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 60;

function fail(err: unknown) {
  const code = err instanceof GoogleAccessError ? err.code : undefined;
  return Response.json({ error: err instanceof Error ? err.message : "Google request failed", google: code }, { status: code ? 403 : 502 });
}

/** Comments and suggested edits in the article's Google Doc. */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const auth = await authorize(projectId, "viewer");
  if (!auth.ok) return auth.response;
  const article = await readArticle(projectId, req.nextUrl.searchParams.get("id") ?? "");
  if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
  if (!article.source.docUrl) return Response.json({ error: "This article isn't linked to a Google Doc." }, { status: 400 });
  try {
    return Response.json({ review: await readReview(projectId, article) });
  } catch (err) {
    return fail(err);
  }
}

/** Replies to, resolves or reopens a comment thread, or adds a comment - as the signed-in Google account. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; id?: unknown; action?: Record<string, unknown> } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const auth = await authorize(projectId, "reviewer");
  if (!auth.ok) return auth.response;
  const article = await readArticle(projectId, typeof body?.id === "string" ? body.id : "");
  if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
  const a = body?.action ?? {};
  const content = typeof a.content === "string" ? a.content.trim().slice(0, 4000) : "";
  const commentId = typeof a.commentId === "string" ? a.commentId : "";
  let action: ReviewAction;
  if (a.type === "comment" && content) action = { type: "comment", content };
  else if (a.type === "reply" && content && commentId) action = { type: "reply", commentId, content };
  else if ((a.type === "resolve" || a.type === "reopen") && commentId) action = { type: a.type, commentId, content };
  else return Response.json({ error: "Write a reply first." }, { status: 400 });
  try {
    await actOnReview(projectId, article, action, auth.viewer.email);
    return Response.json({ review: await readReview(projectId, article) });
  } catch (err) {
    return fail(err);
  }
}
