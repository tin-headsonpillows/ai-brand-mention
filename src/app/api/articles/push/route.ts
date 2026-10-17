import type { NextRequest } from "next/server";
import { authorize } from "@/lib/access/store";
import { readArticle, saveArticles } from "@/lib/articles/store";
import { docIdFrom } from "@/lib/google/content";
import { articleToDocHtml, docState, replaceDocContent } from "@/lib/google/docReview";
import { GoogleAccessError, googleWriteToken } from "@/lib/google/oauth";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 60;

/**
 * Writes the article (as saved here) into its Google Doc. Refuses when the Doc changed since it was last
 * imported or pushed, unless `force` is set, so edits made in the Doc aren't overwritten by accident.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; id?: unknown; force?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const auth = await authorize(projectId, "editor");
  if (!auth.ok) return auth.response;
  const article = await readArticle(projectId, typeof body?.id === "string" ? body.id : "");
  if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
  const docUrl = article.source.docUrl ?? "";
  const now = new Date().toISOString();

  if (docUrl.startsWith("sample:")) {
    const next = { ...article, source: { ...article.source, docModifiedTime: now }, updatedAt: now };
    await saveArticles(projectId, [next]);
    return Response.json({ article: next, simulated: true });
  }
  const docId = docIdFrom(docUrl);
  if (!docId) return Response.json({ error: "This article isn't linked to a Google Doc." }, { status: 400 });
  try {
    const token = await googleWriteToken();
    const state = await docState(token, docId);
    if (!state.canEdit) return Response.json({ error: "Your Google account can't edit this Doc." }, { status: 403 });
    const synced = article.source.docModifiedTime;
    if (body?.force !== true && (!synced || state.modifiedTime > synced)) {
      return Response.json(
        {
          conflict: true,
          error: synced
            ? `The Doc was changed${state.lastModifiedBy ? ` by ${state.lastModifiedBy}` : ""} after it was last imported here. Re-import it first, or overwrite it anyway.`
            : "It isn't known whether the Doc changed since it was imported. Re-import it first, or overwrite it anyway.",
          doc: state,
        },
        { status: 409 }
      );
    }
    const modifiedTime = await replaceDocContent(token, docId, articleToDocHtml(article.title, article.contentHtml, req.nextUrl.origin));
    const next = { ...article, source: { ...article.source, docModifiedTime: modifiedTime || now }, updatedAt: now, updatedBy: auth.viewer.email ?? article.updatedBy };
    await saveArticles(projectId, [next]);
    return Response.json({ article: next, simulated: false });
  } catch (err) {
    const code = err instanceof GoogleAccessError ? err.code : undefined;
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't update the Doc", google: code }, { status: code ? 403 : 502 });
  }
}
