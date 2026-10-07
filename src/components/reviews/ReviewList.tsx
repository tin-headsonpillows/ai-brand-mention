"use client";

import { useState } from "react";
import type { Review, Sentiment } from "@/lib/reviews/types";

const PAGE = 15;

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: "Positive",
  mixed: "Mixed",
  neutral: "Neutral",
  negative: "Negative",
};

export const SENTIMENT_COLOR: Record<Sentiment, string> = {
  positive: "var(--sentiment-positive)",
  mixed: "var(--sentiment-mixed)",
  neutral: "var(--sentiment-neutral)",
  negative: "var(--sentiment-negative)",
};

export function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return null;
  const full = Math.round(rating);
  return (
    <span className="tabular text-xs" style={{ color: "var(--text-secondary)" }} aria-label={`${rating} out of 5`}>
      <span style={{ color: "#E3A008" }}>{"★".repeat(full)}</span>
      <span style={{ color: "var(--gridline)" }}>{"★".repeat(5 - full)}</span>
    </span>
  );
}

export function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: SENTIMENT_COLOR[sentiment] }} />
      {SENTIMENT_LABEL[sentiment]}
    </span>
  );
}

function formatDate(review: Review): string {
  const d = new Date(review.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return review.dateApprox ? `~${d}` : d;
}

function ReviewItem({ review, focusAspect }: { review: Review; focusAspect?: string }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const text = showOriginal || !review.textEn ? review.text : review.textEn;
  const long = text.length > 420;
  const points = review.analysis?.points ?? [];
  return (
    <li className="flex flex-col gap-2 border-b py-3" style={{ borderColor: "var(--gridline)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars rating={review.rating} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }} title={review.dateApprox ? "Approximate - Google only shows a relative date" : undefined}>
          {formatDate(review)}
        </span>
        <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
          {review.authorLink ? (
            <a href={review.authorLink} target="_blank" rel="noreferrer" className="hover:underline">
              {review.author}
            </a>
          ) : (
            review.author
          )}
        </span>
        {review.source !== "Google" ? (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
            {review.source}
          </span>
        ) : null}
        {review.analysis ? <SentimentBadge sentiment={review.analysis.sentiment} /> : null}
        {review.link ? (
          <a href={review.link} target="_blank" rel="noreferrer" className="ml-auto text-xs hover:underline" style={{ color: "var(--series-1)" }}>
            View on Google
          </a>
        ) : null}
      </div>

      {text ? (
        <p className="text-sm whitespace-pre-line" style={{ color: "var(--text-secondary)" }}>
          {long && !expanded ? `${text.slice(0, 420)}…` : text}{" "}
          {long ? (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium" style={{ color: "var(--series-1)" }}>
              {expanded ? "Less" : "More"}
            </button>
          ) : null}
          {review.textEn ? (
            <button type="button" onClick={() => setShowOriginal((v) => !v)} className="ml-2 text-xs font-medium" style={{ color: "var(--series-1)" }}>
              {showOriginal ? "Show translation" : "Show original"}
            </button>
          ) : null}
        </p>
      ) : (
        <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
          Rating only, no text.
        </p>
      )}

      {points.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {points.map((p, i) => {
            const color = p.sentiment === "positive" ? "var(--sentiment-positive)" : "var(--sentiment-negative)";
            const focused = focusAspect === p.aspect;
            return (
              <span
                key={i}
                className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                style={{
                  borderColor: `color-mix(in srgb, ${color} ${focused ? 70 : 35}%, transparent)`,
                  background: `color-mix(in srgb, ${color} ${focused ? 16 : 7}%, transparent)`,
                  color: "var(--text-primary)",
                  fontWeight: focused ? 600 : undefined,
                }}
                title={p.quote}
              >
                <span aria-hidden style={{ color }}>
                  {p.sentiment === "positive" ? "+" : "−"}
                </span>
                {p.aspect}
                {focused && p.quote ? <span className="truncate font-normal" style={{ color: "var(--text-secondary)" }}>&ldquo;{p.quote}&rdquo;</span> : null}
              </span>
            );
          })}
        </div>
      ) : null}

      {review.response ? (
        <details className="text-xs" style={{ color: "var(--text-muted)" }}>
          <summary className="cursor-pointer">Owner replied{review.response.date ? ` · ${new Date(review.response.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</summary>
          <p className="mt-1 whitespace-pre-line rounded p-2" style={{ background: "var(--page-plane)", color: "var(--text-secondary)" }}>
            {review.response.text}
          </p>
        </details>
      ) : null}
    </li>
  );
}

export function ReviewList({ reviews, focusAspect }: { reviews: Review[]; focusAspect?: string }) {
  const [shown, setShown] = useState(PAGE);
  if (reviews.length === 0) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        No reviews match these filters.
      </p>
    );
  }
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {reviews.slice(0, shown).map((r) => (
          <ReviewItem key={r.id} review={r} focusAspect={focusAspect} />
        ))}
      </ul>
      {shown < reviews.length ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE * 2)}
          className="mt-3 self-center rounded-lg border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
        >
          Show more ({reviews.length - shown} left)
        </button>
      ) : null}
    </div>
  );
}
