import type { DocClient } from "./docSync";

/**
 * The review side of an article's Google Doc: comment threads (read, reply, resolve, add), pending suggested
 * edits, and the Docs API client used to write the article back. Calls use the signed-in viewer's token, so
 * replies appear under their own Google name and only Docs they can open are reachable.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function google(url: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<Json> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(url, { method: init.method ?? "GET", headers, body, signal: AbortSignal.timeout(30_000) });
  const data = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string } };
  if (!res.ok) {
    const message = data.error?.message ?? `Google API error ${res.status}`;
    if (res.status === 403 || res.status === 404) throw new Error(`Google says: ${message} - check that your Google account can open this Doc.`);
    throw new Error(message);
  }
  return data;
}

export interface ReviewPerson {
  name: string;
  email?: string;
  photo?: string;
  me?: boolean;
}

export interface ReviewReply {
  id: string;
  author: ReviewPerson;
  content: string;
  createdTime: string;
  /** "resolve" / "reopen" when the reply changed the thread's state. */
  action?: string;
}

export interface ReviewComment {
  id: string;
  author: ReviewPerson;
  content: string;
  /** The Doc text the comment is attached to. */
  quoted: string;
  createdTime: string;
  modifiedTime: string;
  resolved: boolean;
  replies: ReviewReply[];
}

export interface ReviewSuggestion {
  id: string;
  kind: "insert" | "delete" | "replace" | "format";
  inserted: string;
  deleted: string;
  /** The paragraph the suggestion is in, as it reads today. */
  context: string;
}

export interface DocState {
  modifiedTime: string;
  name: string;
  canEdit: boolean;
  canComment: boolean;
  lastModifiedBy?: string;
}

const person = (v: unknown): ReviewPerson => {
  const p = obj(v);
  return { name: str(p.displayName) || "Someone", email: str(p.emailAddress) || undefined, photo: str(p.photoLink) || undefined, me: p.me === true || undefined };
};

const FILES = "https://www.googleapis.com/drive/v3/files";
const COMMENT_FIELDS =
  "id,content,createdTime,modifiedTime,resolved,deleted,quotedFileContent(value),author(displayName,emailAddress,photoLink,me),replies(id,content,createdTime,action,deleted,author(displayName,emailAddress,photoLink,me))";

function toComment(c: Json): ReviewComment {
  return {
    id: str(c.id),
    author: person(c.author),
    content: str(c.content),
    quoted: str(obj(c.quotedFileContent).value),
    createdTime: str(c.createdTime),
    modifiedTime: str(c.modifiedTime) || str(c.createdTime),
    resolved: c.resolved === true,
    replies: arr(c.replies)
      .filter((r) => r.deleted !== true)
      .map((r) => ({ id: str(r.id), author: person(r.author), content: str(r.content), createdTime: str(r.createdTime), action: str(r.action) || undefined })),
  };
}

export async function docState(token: string, fileId: string): Promise<DocState> {
  const f = await google(`${FILES}/${fileId}?fields=name,modifiedTime,capabilities(canEdit,canComment),lastModifyingUser(displayName)&supportsAllDrives=true`, token);
  const caps = obj(f.capabilities);
  return {
    modifiedTime: str(f.modifiedTime),
    name: str(f.name),
    canEdit: caps.canEdit === true,
    canComment: caps.canComment === true,
    lastModifiedBy: str(obj(f.lastModifyingUser).displayName) || undefined,
  };
}

export async function listComments(token: string, fileId: string): Promise<ReviewComment[]> {
  const out: ReviewComment[] = [];
  let page = "";
  for (let i = 0; i < 10; i++) {
    const data = await google(
      `${FILES}/${fileId}/comments?pageSize=100&includeDeleted=false&fields=${encodeURIComponent(`nextPageToken,comments(${COMMENT_FIELDS})`)}${page ? `&pageToken=${page}` : ""}`,
      token
    );
    out.push(...arr(data.comments).filter((c) => c.deleted !== true).map(toComment));
    page = str(data.nextPageToken);
    if (!page) break;
  }
  return out.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
}

/** Replies to a thread; `action` also resolves or reopens it. */
export async function replyToComment(token: string, fileId: string, commentId: string, content: string, action?: "resolve" | "reopen"): Promise<void> {
  await google(`${FILES}/${fileId}/comments/${commentId}/replies?fields=id`, token, { method: "POST", body: { content, ...(action ? { action } : {}) } });
}

/** A new comment on the whole Doc (the API can't attach comments to a text range in Google Docs). */
export async function addComment(token: string, fileId: string, content: string): Promise<void> {
  await google(`${FILES}/${fileId}/comments?fields=id`, token, { method: "POST", body: { content } });
}

/** Pending suggested edits, from the Doc read with suggestions inline (needs edit access to the Doc). */
export async function listSuggestions(token: string, docId: string): Promise<ReviewSuggestion[]> {
  const doc = await google(`https://docs.googleapis.com/v1/documents/${docId}?suggestionsViewMode=SUGGESTIONS_INLINE`, token);
  return suggestionsIn(doc);
}

export function suggestionsIn(doc: Json): ReviewSuggestion[] {
  const found = new Map<string, ReviewSuggestion>();
  const paragraphs: Json[] = [];
  const collect = (content: Json[]) => {
    for (const block of content) {
      if (block.paragraph) paragraphs.push(obj(block.paragraph));
      for (const row of arr(obj(block.table).tableRows)) for (const cell of arr(obj(row).tableCells)) collect(arr(obj(cell).content));
    }
  };
  collect(arr(obj(doc.body).content));
  for (const p of paragraphs) {
    const runs = arr(p.elements).map((e) => obj(e.textRun)).filter((r) => r.content !== undefined);
    // Context: the paragraph as it reads today (suggested insertions left out).
    const context = runs
      .filter((r) => !arr(r.suggestedInsertionIds).length)
      .map((r) => str(r.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    for (const r of runs) {
      const text = str(r.content).replace(/\n$/, "");
      const ensure = (id: string) => {
        const s = found.get(id) ?? { id, kind: "insert" as const, inserted: "", deleted: "", context };
        found.set(id, s);
        return s;
      };
      for (const id of arr(r.suggestedInsertionIds) as unknown as string[]) ensure(id).inserted += text;
      for (const id of arr(r.suggestedDeletionIds) as unknown as string[]) ensure(id).deleted += text;
      for (const id of Object.keys(obj(r.suggestedTextStyleChanges))) ensure(id);
    }
  }
  return [...found.values()]
    .map((s) => ({ ...s, kind: (s.inserted && s.deleted ? "replace" : s.inserted ? "insert" : s.deleted ? "delete" : "format") as ReviewSuggestion["kind"] }))
    .filter((s) => s.inserted.trim() || s.deleted.trim() || s.kind === "format");
}

/** The Docs API for one Doc, as docSync needs it. Reads include pending suggestions so they can be detected. */
export function googleDocClient(token: string, docId: string): DocClient {
  return {
    get: () => google(`https://docs.googleapis.com/v1/documents/${docId}?suggestionsViewMode=SUGGESTIONS_INLINE`, token),
    // One atomic batch; requiredRevisionId makes Google refuse it if someone edited the Doc since it was read.
    batchUpdate: async (requests, revisionId) => {
      await google(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, token, {
        method: "POST",
        body: { requests, ...(revisionId ? { writeControl: { requiredRevisionId: revisionId } } : {}) },
      });
    },
  };
}
