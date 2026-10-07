"use client";

import { useRef, useState } from "react";
import type { PlaceDoc, Sentiment } from "@/lib/reviews/types";
import {
  RANGES,
  aspectRows,
  inRange,
  kpis,
  periodFor,
  ratingDistribution,
  sentimentByBucket,
  subratingAverages,
  type AspectRow,
  type Bucket,
  type RangeKey,
} from "@/lib/reviews/stats";
import { Delta, EmptyState, Headline, Panel, Segmented } from "@/components/tracking/ui";
import { SentimentHeatmap, type HeatmapSelection } from "./SentimentHeatmap";
import { ReviewList, SENTIMENT_COLOR, SENTIMENT_LABEL } from "./ReviewList";

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const pts = (v: number) => `${Math.round(v * 100)} pts`;

const SENTIMENT_ORDER: Sentiment[] = ["positive", "mixed", "neutral", "negative"];

function SentimentTrend({ rows, buckets }: { rows: ReturnType<typeof sentimentByBucket>; buckets: Bucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const labelEvery = Math.ceil(buckets.length / 10);
  const active = hover ?? rows.length - 1;
  const activeRow = rows[active];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        {SENTIMENT_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SENTIMENT_COLOR[s] }} />
            {SENTIMENT_LABEL[s]}
          </span>
        ))}
      </div>
      <div className="text-xs tabular" style={{ color: "var(--text-secondary)" }}>
        {activeRow ? (
          <>
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {buckets[active].title}
            </span>
            {" · "}
            {activeRow.total} reviews · {activeRow.positive} positive · {activeRow.mixed} mixed · {activeRow.negative} negative
          </>
        ) : null}
      </div>
      <div className="flex h-40 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex h-full min-w-0 flex-1 cursor-default flex-col justify-end"
            onMouseEnter={() => setHover(i)}
            title={`${buckets[i].title}: ${row.total} reviews`}
          >
            <div
              className="flex w-full flex-col-reverse gap-px overflow-hidden rounded-t"
              style={{ height: `${(row.total / max) * 100}%`, opacity: hover === null || hover === i ? 1 : 0.55 }}
            >
              {SENTIMENT_ORDER.map((s) =>
                row[s] > 0 ? <div key={s} style={{ flexGrow: row[s], flexBasis: 0, background: SENTIMENT_COLOR[s], minHeight: 2 }} /> : null
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] border-t pt-1" style={{ borderColor: "var(--baseline)" }}>
        {buckets.map((b, i) => (
          <span key={i} className="min-w-0 flex-1 truncate text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
            {i % labelEvery === 0 ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function RatingDistribution({ rows }: { rows: Array<{ stars: number; count: number }> }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.stars} className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
          <span className="tabular" style={{ color: "var(--text-secondary)" }}>
            {r.stars} ★
          </span>
          <div className="h-3 rounded" style={{ background: "var(--page-plane)" }}>
            <div className="h-3 rounded" style={{ width: `${(r.count / max) * 100}%`, background: "var(--de-emphasis)", minWidth: r.count ? 3 : 0 }} />
          </div>
          <span className="text-right tabular" style={{ color: "var(--text-primary)" }}>
            {r.count} <span style={{ color: "var(--text-muted)" }}>({total ? Math.round((r.count / total) * 100) : 0}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function PointsList({
  rows,
  sentiment,
  totalReviews,
  onSelect,
}: {
  rows: AspectRow[];
  sentiment: "positive" | "negative";
  totalReviews: number;
  onSelect: (s: HeatmapSelection) => void;
}) {
  const key = sentiment === "positive" ? "positive" : "negative";
  const top = [...rows].filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 6);
  const max = Math.max(1, ...top.map((r) => r[key]));
  const color = sentiment === "positive" ? "var(--sentiment-positive)" : "var(--sentiment-negative)";
  if (top.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Nothing {sentiment === "positive" ? "praised" : "criticised"} in this period.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {top.map((row) => {
        // Two distinct quotes, newest first - many reviews repeat the same short phrase.
        const seen = new Set<string>();
        const quotes = (sentiment === "positive" ? row.praise : row.criticism)
          .filter((p) => {
            const key = p.point.quote.trim().toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 2);
        return (
          <li key={row.aspect} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => onSelect({ aspect: row.aspect, sentiment })}
              className="grid grid-cols-[minmax(0,1fr)_7rem_3.5rem] items-center gap-2 text-left"
            >
              <span className="truncate text-sm font-medium hover:underline" style={{ color: "var(--text-primary)" }}>
                {row.aspect}
              </span>
              <span className="h-2 rounded" style={{ background: "var(--page-plane)" }}>
                <span className="block h-2 rounded" style={{ width: `${(row[key] / max) * 100}%`, background: color }} />
              </span>
              <span className="text-right text-xs tabular" style={{ color: "var(--text-secondary)" }}>
                {sentiment === "positive" ? "+" : "−"}
                {row[key]}
              </span>
            </button>
            {quotes.map((q, i) => (
              <p key={i} className="truncate pl-2 text-xs italic" style={{ color: "var(--text-muted)", borderLeft: `2px solid ${color}` }} title={q.point.quote}>
                &ldquo;{q.point.quote}&rdquo;
              </p>
            ))}
          </li>
        );
      })}
      <li className="text-xs" style={{ color: "var(--text-muted)" }}>
        Counts are points made across {totalReviews} reviews; one review can praise one thing and criticise another.
      </li>
    </ol>
  );
}

type SentimentFilter = "all" | Sentiment;

export function ReviewsDashboard({ doc }: { doc: PlaceDoc }) {
  const [range, setRange] = useState<RangeKey>("12m");
  const [selection, setSelection] = useState<HeatmapSelection | null>(null);
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const period = periodFor(doc, range);
  const current = inRange(doc.reviews, period.start, period.end);
  const k = kpis(current);
  const prev = period.previous ? kpis(inRange(doc.reviews, period.previous.start, period.previous.end)) : null;
  const rows = aspectRows(current, period.buckets, doc.taxonomy);
  const trend = sentimentByBucket(current, period.buckets);
  const subratings = subratingAverages(current);
  const analysedShare = doc.reviews.length ? doc.reviews.filter((r) => r.analysis).length / doc.reviews.length : 0;

  const select = (s: HeatmapSelection) => {
    setSelection(s);
    setSentimentFilter("all");
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // Review list: the heatmap selection narrows by aspect / sentiment / period, then the list's own filters apply.
  const bucket = selection?.bucket !== undefined ? period.buckets[selection.bucket] : null;
  const term = search.trim().toLowerCase();
  const listed = current.filter((r) => {
    if (bucket) {
      const t = Date.parse(r.date);
      if (t < bucket.start || t >= bucket.end) return false;
    }
    if (selection) {
      const match = (r.analysis?.points ?? []).some(
        (p) => p.aspect === selection.aspect && (!selection.sentiment || p.sentiment === selection.sentiment)
      );
      if (!match) return false;
    }
    if (sentimentFilter !== "all" && r.analysis?.sentiment !== sentimentFilter) return false;
    if (term && !`${r.text} ${r.textEn ?? ""} ${r.author}`.toLowerCase().includes(term)) return false;
    return true;
  });

  const deltaTitle = period.previous
    ? `vs ${new Date(period.previous.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(period.previous.end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={range}
          options={RANGES.map((r) => ({ value: r.key, label: r.label }))}
          onChange={(v) => {
            setRange(v);
            setSelection(null);
          }}
          ariaLabel="Time range"
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {new Date(period.start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} –{" "}
          {new Date(period.end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          {doc.place.source === "hotels" ? " · Google Hotels shows relative dates, so placement in time is approximate" : ""}
        </span>
      </div>

      {analysedShare < 1 ? (
        <p className="text-xs" style={{ color: "var(--status-warning)" }}>
          {Math.round(analysedShare * 100)}% of stored reviews analysed so far - sentiment figures fill in as the analysis finishes.
        </p>
      ) : null}

      <section
        className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border p-4 md:grid-cols-5"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
        aria-label="Headline numbers"
      >
        <Headline
          label="Reviews"
          value={String(k.count)}
          delta={prev ? <Delta value={k.count - prev.count} format={(v) => String(v)} title={deltaTitle} /> : undefined}
        />
        <Headline
          label="Average rating"
          value={k.avgRating === null ? "–" : k.avgRating.toFixed(2)}
          delta={
            prev && k.avgRating !== null && prev.avgRating !== null ? (
              <Delta value={k.avgRating - prev.avgRating} format={(v) => v.toFixed(2)} title={deltaTitle} />
            ) : undefined
          }
        />
        <Headline
          label="Positive reviews"
          value={pct(k.positiveShare)}
          delta={
            prev && k.positiveShare !== null && prev.positiveShare !== null ? (
              <Delta value={k.positiveShare - prev.positiveShare} format={pts} title={deltaTitle} />
            ) : undefined
          }
        />
        <Headline
          label="Negative reviews"
          value={pct(k.negativeShare)}
          delta={
            prev && k.negativeShare !== null && prev.negativeShare !== null ? (
              <Delta value={k.negativeShare - prev.negativeShare} format={pts} higherIsBetter={false} title={deltaTitle} />
            ) : undefined
          }
        />
        <Headline
          label="Owner replies"
          value={pct(k.responseRate)}
          delta={
            prev && k.responseRate !== null && prev.responseRate !== null ? (
              <Delta value={k.responseRate - prev.responseRate} format={pts} title={deltaTitle} />
            ) : undefined
          }
        />
      </section>

      {current.length === 0 ? (
        <EmptyState title="No reviews in this period" body="Pick a longer time range, or refresh to check for new reviews." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel title="Sentiment over time" subtitle="reviews per period by overall sentiment">
              <SentimentTrend rows={trend} buckets={period.buckets} />
            </Panel>
            <Panel title="Star ratings" subtitle={`${k.count} reviews`}>
              <RatingDistribution rows={ratingDistribution(current)} />
              {subratings.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 border-t pt-3" style={{ borderColor: "var(--gridline)" }}>
                  {subratings.slice(0, 6).map((s) => (
                    <div key={s.key} className="flex flex-col" title={`Average of ${s.count} reviews that rated ${s.key}`}>
                      <span className="text-[11px] capitalize" style={{ color: "var(--text-muted)" }}>
                        {s.key}
                      </span>
                      <span className="text-sm font-semibold tabular" style={{ color: "var(--text-primary)" }}>
                        {s.avg.toFixed(1)}
                        <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                          /5
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Panel>
          </div>

          <Panel title="Praise & criticism heatmap" subtitle="specific points customers raise, by aspect and period">
            {rows.length ? (
              <SentimentHeatmap rows={rows} buckets={period.buckets} selection={selection} onSelect={select} />
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No specific points found yet - they appear once the reviews are analysed.
              </p>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel title="Top praise" subtitle="what customers love">
              <PointsList rows={rows} sentiment="positive" totalReviews={k.count} onSelect={select} />
            </Panel>
            <Panel title="Top criticism" subtitle="what customers complain about">
              <PointsList rows={rows} sentiment="negative" totalReviews={k.count} onSelect={select} />
            </Panel>
          </div>
        </>
      )}

      {doc.topics.length > 0 ? (
        <Panel title="Google's review topics" subtitle="keywords Google highlights across all reviews">
          <div className="flex flex-wrap gap-1.5">
            {doc.topics.slice(0, 24).map((t) => (
              <span key={t.keyword} className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
                {t.keyword} <span className="tabular" style={{ color: "var(--text-muted)" }}>{t.mentions}</span>
              </span>
            ))}
          </div>
        </Panel>
      ) : null}

      <div ref={listRef} className="scroll-mt-4">
        <Panel
          title="Reviews"
          subtitle={`${listed.length} of ${current.length} in this period`}
          actions={
            <Segmented
              value={sentimentFilter}
              options={[
                { value: "all", label: "All" },
                { value: "positive", label: "Positive" },
                { value: "mixed", label: "Mixed" },
                { value: "negative", label: "Negative" },
              ]}
              onChange={setSentimentFilter}
              ariaLabel="Filter by sentiment"
            />
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search review text"
              className="w-56 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
              style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" }}
            />
            {selection ? (
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)", background: "var(--page-plane)" }}
                title="Clear this filter"
              >
                {selection.sentiment ? (
                  <span
                    aria-hidden
                    style={{ color: selection.sentiment === "positive" ? "var(--sentiment-positive)" : "var(--sentiment-negative)" }}
                  >
                    {selection.sentiment === "positive" ? "+" : "−"}
                  </span>
                ) : null}
                {selection.aspect}
                {selection.sentiment ? ` · ${selection.sentiment === "positive" ? "praise" : "criticism"}` : ""}
                {bucket ? ` · ${bucket.title}` : ""}
                <span aria-hidden style={{ color: "var(--text-muted)" }}>
                  ×
                </span>
              </button>
            ) : (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Click the heatmap or the praise / criticism lists to filter by aspect.
              </span>
            )}
          </div>
          <ReviewList
            key={`${range}|${selection?.aspect}|${selection?.sentiment}|${selection?.bucket}|${sentimentFilter}|${term}`}
            reviews={listed}
            focusAspect={selection?.aspect}
          />
        </Panel>
      </div>
    </div>
  );
}
