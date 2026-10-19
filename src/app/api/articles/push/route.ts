import type { NextRequest } from "next/server";
import { authorize } from "@/lib/access/store";
import { readArticle, saveArticles } from "@/lib/articles/store";
import { docIdFrom } from "@/lib/google/content";
import { docState, googleDocClient } from "@/lib/google/docReview";
import { DocSyncError, syncArticleToDoc, type SyncSummary } from "@/lib/google/docSync";
import { GoogleAccessError, googleWriteToken } from "@/lib/google/oauth";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 60;

/**
 * Brings the article's Google Doc in line with the article as saved here, as small in-place edits: the Doc keeps
 * its formatting, comments and layout, and only the words that differ are changed. With `dryRun` it only reports
 * what would change. Refuses when the Doc was edited after it was last imported (unless `force`), when it has
 * pending suggested edits, or when Google says someone edited it while the update was running.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; id?: unknown; force?: unknown; dryRun?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const auth = await authorize(projectId, "editor");
  if (!auth.ok) return auth.response;
  const article = await readArticle(projectId, typeof body?.id === "string" ? body.id : "");
  if (!article) return Response.json({ error: "Article not found" }, { status: 404 });
  const docUrl = article.source.docUrl ?? "";
  const dryRun = body?.dryRun === true;
  const now = new Date().toISOString();

  if (docUrl.startsWith("sample:")) {
    const summary: SyncSummary = { unchanged: false, edits: [], added: [], removed: [], headings: 0, marks: 0, skipped: ["Sample article: nothing is sent to Google."] };
    if (dryRun) return Response.json({ summary, simulated: true });
    const next = { ...article, source: { ...article.source, docModifiedTime: now }, updatedAt: now };
    await saveArticles(projectId, [next]);
    return Response.json({ article: next, summary, simulated: true });
  }
  const docId = docIdFrom(docUrl);
  if (!docId) return Response.json({ error: "This article isn't linked to a Google Doc." }, { status: 400 });
  try {
    const token = await googleWriteToken();
    const state = await docState(token, docId);
    if (!state.canEdit) return Response.json({ error: "Your Google account can't edit this Doc." }, { status: 403 });
    const synced = article.source.docModifiedTime;
    const changedSince = !synced || state.modifiedTime > synced;
    // On a preview the conflict is reported along with the changes, so they can be judged before overriding.
    const conflict = changedSince
      ? synced
        ? `The Doc was changed${state.lastModifiedBy ? ` by ${state.lastModifiedBy}` : ""} after it was last imported here. Updating now would also set any parts edited there back to this article's text. Re-import first to keep those edits.`
        : "It isn't known whether the Doc changed since it was imported here. Updating now would set any parts edited there back to this article's text."
      : null;
    if (!dryRun && conflict && body?.force !== true) return Response.json({ conflict: true, error: conflict, doc: state }, { status: 409 });

    const summary = await syncArticleToDoc(googleDocClient(token, docId), { title: article.title, html: article.contentHtml }, { dryRun });
    if (dryRun) return Response.json({ summary, conflict, doc: state });

    // What the Doc's clock says now, so the update itself doesn't count as an outside change.
    const after = summary.unchanged ? state : await docState(token, docId);
    const next = { ...article, source: { ...article.source, docModifiedTime: after.modifiedTime || now }, updatedAt: now, updatedBy: auth.viewer.email ?? article.updatedBy };
    await saveArticles(projectId, [next]);
    return Response.json({ article: next, summary });
  } catch (err) {
    if (err instanceof DocSyncError) return Response.json({ error: err.message, code: err.code }, { status: 409 });
    const code = err instanceof GoogleAccessError ? err.code : undefined;
    const message = err instanceof Error ? err.message : "Couldn't update the Doc";
    // Google refuses the whole batch when the Doc moved on while it was being updated; nothing was changed.
    if (/revision/i.test(message)) return Response.json({ error: "Someone edited the Doc while it was being updated, so nothing was changed. Try again.", code: "raced" }, { status: 409 });
    return Response.json({ error: message, google: code }, { status: code ? 403 : 502 });
  }
}
