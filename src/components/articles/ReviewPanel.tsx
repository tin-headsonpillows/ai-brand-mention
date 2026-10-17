"use client";

import { useCallback, useEffect, useState } from "react";
import type { ArticleReview } from "@/lib/articles/review";
import type { ReviewComment } from "@/lib/google/docReview";
import { Segmented } from "@/components/tracking/ui";
import { buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

type Filter = "open" | "resolved" | "all";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/**
 * The article's Google Doc review: whether the Doc changed since it was imported, pending suggested edits
 * (accepted or rejected in the Doc - Google's API can't), and comment threads to read, reply to and resolve.
 */
export function ReviewPanel({
  projectId,
  articleId,
  docUrl,
  canReply,
  canEdit,
  onReimport,
  onPush,
  pushing,
  onChangedState,
}: {
  projectId: string;
  articleId: string;
  docUrl: string;
  canReply: boolean;
  canEdit: boolean;
  onReimport: () => void;
  onPush: () => void;
  pushing: boolean;
  /** Tells the editor whether the Doc has changes it hasn't imported yet. */
  onChangedState?: (changed: boolean) => void;
}) {
  const [review, setReview] = useState<ArticleReview | null>(null);
  const [error, setError] = useState<{ message: string; google?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/articles/review?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(articleId)}`, { cache: "no-store" })
      .then(async (res) => ({ res, data: (await res.json().catch(() => ({}))) as { review?: ArticleReview; error?: string; google?: string } }))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok || !data.review) setError({ message: data.error ?? "Couldn't read the Doc's comments", google: data.google });
        else {
          setReview(data.review);
          setError(null);
          const r = data.review;
          onChangedState?.(Boolean(r.syncedModifiedTime && r.doc.modifiedTime > r.syncedModifiedTime));
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, articleId, reloads, onChangedState]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloads((n) => n + 1);
  }, []);

  async function act(key: string, action: Record<string, unknown>) {
    setBusy(key);
    try {
      const res = await fetch("/api/articles/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, id: articleId, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { review?: ArticleReview; error?: string; google?: string };
      if (!res.ok || !data.review) throw new Error(data.error ?? "Couldn't post to the Doc");
      setReview(data.review);
      setError(null);
      return true;
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : "Couldn't post to the Doc" });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (loading && !review) return <p className="text-xs" style={{ color: "var(--text-muted)" }}>Reading the Doc&apos;s comments and suggestions...</p>;

  if (!review) {
    const signIn = error?.google === "signed_out" || error?.google === "needs_consent";
    return (
      <div className="flex flex-col gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        <p>{error?.message}</p>
        {signIn ? (
          <a href={`/api/google/auth?returnTo=${encodeURIComponent(`/articles?project=${projectId}&article=${articleId}`)}`} className="self-start font-medium underline" style={{ color: "var(--series-1)" }}>
            Sign in with Google
          </a>
        ) : null}
        <p style={{ color: "var(--text-muted)" }}>Comments and suggested edits are read from the Doc with your Google account, so Google sign-in is needed (Articles → Settings).</p>
      </div>
    );
  }

  const changed = Boolean(review.syncedModifiedTime && review.doc.modifiedTime > review.syncedModifiedTime);
  const shown = review.comments.filter((c) => (filter === "all" ? true : filter === "open" ? !c.resolved : c.resolved));
  const openCount = review.comments.filter((c) => !c.resolved).length;

  return (
    <div className="flex flex-col gap-4 text-xs">
      {review.simulated ? (
        <p className="rounded-md border px-2 py-1.5" style={{ borderColor: "var(--border-hairline)", color: "var(--text-muted)" }}>
          Sample article: comments and suggestions are simulated.
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-semibold" style={{ color: "var(--text-primary)" }}>
            Google Doc
          </h4>
          <button type="button" onClick={refresh} disabled={loading} className="underline" style={{ color: "var(--text-muted)" }}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <p style={{ color: "var(--text-secondary)" }}>
          Last changed {when(review.doc.modifiedTime)}
          {review.doc.lastModifiedBy ? ` by ${review.doc.lastModifiedBy}` : ""}.{" "}
          {changed ? <b style={{ color: "var(--status-critical)" }}>Changed since it was imported here.</b> : review.syncedModifiedTime ? "In step with this article." : ""}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onReimport} className={buttonSecondary} style={secondaryStyle}>
              Re-import from Doc
            </button>
            <button type="button" onClick={onPush} disabled={pushing || !review.doc.canEdit} className={buttonSecondary} style={secondaryStyle} title="Replace the Doc's text with this article">
              {pushing ? "Updating Doc..." : "Update Doc from here"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="font-semibold" style={{ color: "var(--text-primary)" }}>
          Suggested edits ({review.suggestions.length})
        </h4>
        {review.suggestionsNote ? <p style={{ color: "var(--text-muted)" }}>{review.suggestionsNote}</p> : null}
        {review.suggestions.length ? (
          <>
            <ul className="flex flex-col gap-2">
              {review.suggestions.map((s) => (
                <li key={s.id} className="flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: "var(--border-hairline)" }}>
                  <span style={{ color: "var(--text-muted)" }}>{s.kind === "replace" ? "Replace" : s.kind === "insert" ? "Insert" : s.kind === "delete" ? "Delete" : "Formatting change"}</span>
                  {s.deleted ? (
                    <span className="line-through" style={{ color: "var(--text-secondary)" }}>
                      − {s.deleted}
                    </span>
                  ) : null}
                  {s.inserted ? <span style={{ color: "var(--success-text)" }}>+ {s.inserted}</span> : null}
                  {s.context ? (
                    <span className="line-clamp-2" style={{ color: "var(--text-muted)" }}>
                      in: “{s.context}”
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <a href={docUrl.startsWith("http") ? docUrl : undefined} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--series-1)" }}>
              Accept or reject them in the Doc ↗
            </a>
            <p style={{ color: "var(--text-muted)" }}>Then re-import: imports leave pending suggestions out.</p>
          </>
        ) : !review.suggestionsNote ? (
          <p style={{ color: "var(--text-muted)" }}>None pending.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-semibold" style={{ color: "var(--text-primary)" }}>
            Comments ({openCount} open)
          </h4>
          <Segmented
            value={filter}
            options={[
              { value: "open", label: "Open" },
              { value: "resolved", label: "Resolved" },
              { value: "all", label: "All" },
            ]}
            onChange={setFilter}
            ariaLabel="Comment filter"
          />
        </div>
        {shown.length ? (
          <ul className="flex flex-col gap-2">
            {shown.map((c) => (
              <Thread key={c.id} comment={c} canReply={canReply} busy={busy} onAct={act} />
            ))}
          </ul>
        ) : (
          <p style={{ color: "var(--text-muted)" }}>No {filter === "all" ? "" : filter} comments.</p>
        )}
        {canReply ? (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (newComment.trim() && (await act("new", { type: "comment", content: newComment }))) setNewComment("");
            }}
          >
            <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} rows={2} placeholder="Comment on the whole Doc..." className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none" style={fieldStyle} aria-label="New comment" />
            <button type="submit" disabled={busy !== null || !newComment.trim()} className={`${buttonSecondary} self-end`} style={secondaryStyle}>
              {busy === "new" ? "Posting..." : "Comment"}
            </button>
          </form>
        ) : null}
      </section>

      {error ? (
        <p role="alert" style={{ color: "var(--status-critical)" }}>
          {error.message}
        </p>
      ) : null}
    </div>
  );
}

function Thread({ comment, canReply, busy, onAct }: { comment: ReviewComment; canReply: boolean; busy: string | null; onAct: (key: string, action: Record<string, unknown>) => Promise<boolean> }) {
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-2.5" style={{ borderColor: "var(--border-hairline)", opacity: comment.resolved ? 0.75 : 1 }}>
      <div className="flex items-baseline justify-between gap-2">
        <b style={{ color: "var(--text-primary)" }}>{comment.author.name}</b>
        <span style={{ color: "var(--text-muted)" }}>{when(comment.createdTime)}</span>
      </div>
      {comment.quoted ? (
        <span className="line-clamp-2 border-l-2 pl-2 italic" style={{ borderColor: "var(--series-1)", color: "var(--text-muted)" }}>
          {comment.quoted}
        </span>
      ) : null}
      <p className="whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
        {comment.content}
      </p>
      {comment.replies.length ? (
        <ul className="ml-2 flex flex-col gap-1.5 border-l pl-2" style={{ borderColor: "var(--border-hairline)" }}>
          {comment.replies.map((r) => (
            <li key={r.id}>
              <b style={{ color: "var(--text-secondary)" }}>{r.author.name}</b> <span style={{ color: "var(--text-muted)" }}>{when(r.createdTime)}</span>
              {r.action ? <span style={{ color: "var(--text-muted)" }}> · {r.action === "resolve" ? "marked resolved" : "reopened"}</span> : null}
              {r.content ? (
                <p className="whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                  {r.content}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canReply ? (
        open ? (
          <div className="flex flex-col gap-1.5">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Reply..." className="w-full rounded-lg border px-2 py-1.5 text-xs outline-none" style={fieldStyle} aria-label="Reply" autoFocus />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="underline" style={{ color: "var(--text-muted)" }}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null || !reply.trim()}
                onClick={async () => {
                  if (await onAct(comment.id, { type: "reply", commentId: comment.id, content: reply })) {
                    setReply("");
                    setOpen(false);
                  }
                }}
                className={buttonSecondary}
                style={secondaryStyle}
              >
                {busy === comment.id ? "Sending..." : "Reply"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button type="button" onClick={() => setOpen(true)} className="underline" style={{ color: "var(--series-1)" }}>
              Reply
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void onAct(comment.id, { type: comment.resolved ? "reopen" : "resolve", commentId: comment.id })}
              className="underline"
              style={{ color: "var(--text-secondary)" }}
            >
              {comment.resolved ? "Reopen" : "Resolve"}
            </button>
          </div>
        )
      ) : null}
    </li>
  );
}
