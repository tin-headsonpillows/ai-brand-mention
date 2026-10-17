import { readJson, writeJson } from "../blobJson";
import { docIdFrom } from "../google/content";
import { addComment, docState, listComments, listSuggestions, replyToComment, type DocState, type ReviewComment, type ReviewSuggestion } from "../google/docReview";
import { googleWriteToken } from "../google/oauth";
import type { Article } from "./types";

/**
 * An article's Doc review: comments and suggested edits from its Google Doc. Sample articles get a simulated
 * thread (kept per article) so the review flow can be tried without Google.
 */

export interface ArticleReview {
  doc: DocState;
  /** The Doc's modifiedTime when the article was last imported or pushed from here. */
  syncedModifiedTime?: string;
  comments: ReviewComment[];
  suggestions: ReviewSuggestion[];
  /** Why suggestions couldn't be listed (they need edit access to the Doc). */
  suggestionsNote?: string;
  simulated: boolean;
}

export type ReviewAction = { type: "reply"; commentId: string; content: string } | { type: "resolve" | "reopen"; commentId: string; content?: string } | { type: "comment"; content: string };

const isSample = (a: Article) => Boolean(a.source.docUrl?.startsWith("sample:"));
const samplePath = (projectId: string, id: string) => `articles/${projectId}/sample-review/${id}.json`;

function sampleSeed(article: Article): { comments: ReviewComment[] } {
  const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const firstText = article.contentHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    comments: [
      {
        id: "c1",
        author: { name: "Client (sample)", email: "client@example.com" },
        content: "Can we mention the free airport pickup here? It's our main selling point.",
        quoted: firstText.slice(0, 80),
        createdTime: t(180),
        modifiedTime: t(60),
        resolved: false,
        replies: [{ id: "r1", author: { name: "Writer A (sample)" }, content: "Good idea - adding it to the intro.", createdTime: t(60) }],
      },
      {
        id: "c2",
        author: { name: "SEO editor (sample)" },
        content: "Please add the focus keyword to one H2.",
        quoted: "",
        createdTime: t(1440),
        modifiedTime: t(1400),
        resolved: true,
        replies: [{ id: "r2", author: { name: "Writer A (sample)" }, content: "Done.", createdTime: t(1400), action: "resolve" }],
      },
    ],
  };
}

const SAMPLE_SUGGESTIONS = (article: Article): ReviewSuggestion[] => {
  const text = article.contentHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return [
    { id: "suggest.s1", kind: "replace", deleted: "very good", inserted: "excellent", context: text.slice(0, 160) },
    { id: "suggest.s2", kind: "insert", deleted: "", inserted: " (open daily 7am-10pm)", context: text.slice(160, 320) },
  ];
};

export async function readReview(projectId: string, article: Article): Promise<ArticleReview> {
  const docUrl = article.source.docUrl ?? "";
  if (isSample(article)) {
    const stored = (await readJson<{ comments: ReviewComment[] }>(samplePath(projectId, article.id))) ?? sampleSeed(article);
    return {
      doc: { modifiedTime: article.source.importedAt ?? article.createdAt, name: article.title, canEdit: true, canComment: true, lastModifiedBy: "Writer A (sample)" },
      syncedModifiedTime: article.source.docModifiedTime ?? article.source.importedAt,
      comments: stored.comments,
      suggestions: SAMPLE_SUGGESTIONS(article),
      simulated: true,
    };
  }
  const docId = docIdFrom(docUrl);
  if (!docId) throw new Error("This article isn't linked to a Google Doc.");
  const token = await googleWriteToken();
  const [doc, comments] = await Promise.all([docState(token, docId), listComments(token, docId)]);
  let suggestions: ReviewSuggestion[] = [];
  let suggestionsNote: string | undefined;
  if (doc.canEdit) suggestions = await listSuggestions(token, docId).catch((err: unknown) => ((suggestionsNote = err instanceof Error ? err.message : "Couldn't read suggestions"), []));
  else suggestionsNote = "Suggested edits are only visible to accounts that can edit the Doc.";
  return { doc, syncedModifiedTime: article.source.docModifiedTime, comments, suggestions, suggestionsNote, simulated: false };
}

export async function actOnReview(projectId: string, article: Article, action: ReviewAction, by: string | undefined): Promise<void> {
  if (isSample(article)) {
    const stored = (await readJson<{ comments: ReviewComment[] }>(samplePath(projectId, article.id))) ?? sampleSeed(article);
    const now = new Date().toISOString();
    const author = { name: by ?? "You", email: by, me: true };
    if (action.type === "comment") stored.comments.unshift({ id: `c${Date.now()}`, author, content: action.content, quoted: "", createdTime: now, modifiedTime: now, resolved: false, replies: [] });
    else {
      const c = stored.comments.find((x) => x.id === action.commentId);
      if (!c) throw new Error("That comment is gone.");
      const verb = action.type === "reply" ? undefined : action.type;
      c.replies.push({ id: `r${Date.now()}`, author, content: action.content ?? "", createdTime: now, action: verb });
      if (verb) c.resolved = verb === "resolve";
      c.modifiedTime = now;
    }
    await writeJson(samplePath(projectId, article.id), stored);
    return;
  }
  const docId = docIdFrom(article.source.docUrl ?? "");
  if (!docId) throw new Error("This article isn't linked to a Google Doc.");
  const token = await googleWriteToken();
  if (action.type === "comment") await addComment(token, docId, action.content);
  else if (action.type === "reply") await replyToComment(token, docId, action.commentId, action.content);
  else await replyToComment(token, docId, action.commentId, action.content ?? "", action.type);
}
