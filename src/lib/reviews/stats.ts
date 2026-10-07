import { OTHER_ASPECT } from "./analyze-shared";
import { monthsBefore } from "./dates";
import type { PlaceDoc, Review, ReviewPoint, Sentiment } from "./types";

export type RangeKey = "7d" | "28d" | "3m" | "6m" | "12m" | "all";
type BucketUnit = "day" | "week" | "month" | "quarter";

export const RANGES: Array<{ key: RangeKey; label: string; days?: number; months?: number; unit: BucketUnit }> = [
  { key: "7d", label: "7 days", days: 7, unit: "day" },
  { key: "28d", label: "28 days", days: 28, unit: "week" },
  { key: "3m", label: "3 months", months: 3, unit: "week" },
  { key: "6m", label: "6 months", months: 6, unit: "month" },
  { key: "12m", label: "12 months", months: 12, unit: "month" },
  { key: "all", label: "All", unit: "month" },
];

const DAY = 86_400_000;

export interface Bucket {
  start: number;
  end: number;
  label: string;
  title: string;
}

export interface Period {
  start: number;
  end: number;
  buckets: Bucket[];
  /** The equally long period just before, when the stored history reaches back that far. */
  previous: { start: number; end: number } | null;
}

/** When the data is "as of": the last completed sync, so filters line up with what was fetched. */
export function asOf(doc: PlaceDoc): number {
  return Date.parse(doc.lastSyncedAt ?? new Date().toISOString());
}

/** How far back the stored reviews are complete (the fetch window, or the oldest review if the cap cut it short). */
export function historyStart(doc: PlaceDoc): number {
  const oldest = doc.reviews.length ? Date.parse(doc.reviews[doc.reviews.length - 1].date) : asOf(doc);
  const windowStart = doc.settings.monthsBack > 0 ? monthsBefore(new Date(asOf(doc)), doc.settings.monthsBack).getTime() : oldest;
  return doc.reviews.length >= doc.settings.maxReviews ? Math.max(windowStart, oldest) : windowStart;
}

const fmtDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtMonth = (t: number, year = false) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", ...(year ? { year: "2-digit" } : {}), timeZone: "UTC" });

function startOfDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function buildBuckets(start: number, end: number, unit: BucketUnit): Bucket[] {
  const buckets: Bucket[] = [];
  if (unit === "day" || unit === "week") {
    // Anchored on the as-of day, counting back, so the newest bucket is always complete.
    const size = unit === "day" ? DAY : 7 * DAY;
    let bEnd = startOfDay(end) + DAY;
    while (bEnd > start) {
      const bStart = Math.max(start, bEnd - size);
      buckets.unshift({
        start: bStart,
        end: bEnd,
        label: unit === "day" ? fmtDay(bStart) : fmtDay(bStart),
        title: unit === "day" ? fmtDay(bStart) : `${fmtDay(bStart)} – ${fmtDay(bEnd - DAY)}`,
      });
      bEnd = bStart;
    }
    return buckets;
  }
  const step = unit === "month" ? 1 : 3;
  const s = new Date(start);
  let cursor = Date.UTC(s.getUTCFullYear(), unit === "month" ? s.getUTCMonth() : s.getUTCMonth() - (s.getUTCMonth() % 3), 1);
  const spansYears = new Date(start).getUTCFullYear() !== new Date(end).getUTCFullYear();
  while (cursor <= end) {
    const c = new Date(cursor);
    const next = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + step, 1);
    const label =
      unit === "month" ? fmtMonth(cursor, spansYears && (c.getUTCMonth() === 0 || buckets.length === 0)) : `Q${Math.floor(c.getUTCMonth() / 3) + 1} '${String(c.getUTCFullYear()).slice(2)}`;
    buckets.push({
      start: Math.max(cursor, start),
      end: Math.min(next, end + 1),
      label,
      title: `${fmtDay(Math.max(cursor, start))} – ${fmtDay(Math.min(next, end + 1) - DAY)}, ${c.getUTCFullYear()}`,
    });
    cursor = next;
  }
  return buckets;
}

export function periodFor(doc: PlaceDoc, range: RangeKey): Period {
  const def = RANGES.find((r) => r.key === range) ?? RANGES[4];
  const end = asOf(doc);
  let start: number;
  let unit = def.unit;
  // Whole days, so day/week buckets tile the range exactly with no stub column.
  if (def.days) start = startOfDay(end) + DAY - def.days * DAY;
  else if (def.months) start = monthsBefore(new Date(end), def.months).getTime();
  else {
    start = doc.reviews.length ? startOfDay(Date.parse(doc.reviews[doc.reviews.length - 1].date)) : end - 30 * DAY;
    if (end - start > 730 * DAY) unit = "quarter";
  }
  const length = end - start;
  const previous = range !== "all" && start - length >= historyStart(doc) - DAY ? { start: start - length, end: start } : null;
  return { start, end, buckets: buildBuckets(start, end, unit), previous };
}

export function inRange(reviews: Review[], start: number, end: number): Review[] {
  return reviews.filter((r) => {
    const t = Date.parse(r.date);
    return t >= start && t <= end;
  });
}

// ---------------------------------------------------------------------------------------------
// Headline numbers
// ---------------------------------------------------------------------------------------------

export interface Kpis {
  count: number;
  avgRating: number | null;
  positiveShare: number | null;
  negativeShare: number | null;
  responseRate: number | null;
  sentiments: Record<Sentiment, number>;
}

export function kpis(reviews: Review[]): Kpis {
  const rated = reviews.filter((r) => r.rating !== null);
  const analysed = reviews.filter((r) => r.analysis);
  const sentiments: Record<Sentiment, number> = { positive: 0, mixed: 0, neutral: 0, negative: 0 };
  for (const r of analysed) sentiments[r.analysis!.sentiment]++;
  return {
    count: reviews.length,
    avgRating: rated.length ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length : null,
    positiveShare: analysed.length ? sentiments.positive / analysed.length : null,
    negativeShare: analysed.length ? sentiments.negative / analysed.length : null,
    responseRate: reviews.length ? reviews.filter((r) => r.response).length / reviews.length : null,
    sentiments,
  };
}

export function ratingDistribution(reviews: Review[]): Array<{ stars: number; count: number }> {
  const counts = [0, 0, 0, 0, 0];
  for (const r of reviews) {
    if (r.rating === null) continue;
    const stars = Math.min(5, Math.max(1, Math.round(r.rating)));
    counts[stars - 1]++;
  }
  return [5, 4, 3, 2, 1].map((stars) => ({ stars, count: counts[stars - 1] }));
}

export function subratingAverages(reviews: Review[]): Array<{ key: string; avg: number; count: number }> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const r of reviews) {
    for (const [key, value] of Object.entries(r.subratings ?? {})) {
      const entry = sums.get(key) ?? { sum: 0, count: 0 };
      entry.sum += value;
      entry.count++;
      sums.set(key, entry);
    }
  }
  return Array.from(sums.entries())
    .map(([key, { sum, count }]) => ({ key, avg: sum / count, count }))
    .filter((s) => s.count >= 3)
    .sort((a, b) => b.count - a.count);
}

export function sentimentByBucket(reviews: Review[], buckets: Bucket[]): Array<Record<Sentiment, number> & { total: number }> {
  const rows = buckets.map(() => ({ positive: 0, mixed: 0, neutral: 0, negative: 0, total: 0 }));
  for (const r of reviews) {
    const i = bucketIndex(Date.parse(r.date), buckets);
    if (i === -1) continue;
    rows[i].total++;
    if (r.analysis) rows[i][r.analysis.sentiment]++;
  }
  return rows;
}

function bucketIndex(t: number, buckets: Bucket[]): number {
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (t >= buckets[i].start && t < buckets[i].end) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Aspects: the heatmap and the praise / criticism lists
// ---------------------------------------------------------------------------------------------

export interface PointRef {
  review: Review;
  point: ReviewPoint;
}

export interface AspectRow {
  aspect: string;
  positive: number;
  negative: number;
  /** Reviews that mention the aspect at all. */
  reviews: number;
  cells: Array<{ positive: number; negative: number }>;
  praise: PointRef[];
  criticism: PointRef[];
}

/** Mentions per aspect, overall and per bucket, newest quotes first. "Other" sorts last. */
export function aspectRows(reviews: Review[], buckets: Bucket[], taxonomy: string[]): AspectRow[] {
  const rows = new Map<string, AspectRow>();
  const row = (aspect: string) => {
    let r = rows.get(aspect);
    if (!r) {
      r = { aspect, positive: 0, negative: 0, reviews: 0, cells: buckets.map(() => ({ positive: 0, negative: 0 })), praise: [], criticism: [] };
      rows.set(aspect, r);
    }
    return r;
  };
  for (const aspect of taxonomy) row(aspect);

  for (const review of reviews) {
    const points = review.analysis?.points ?? [];
    const i = bucketIndex(Date.parse(review.date), buckets);
    const touched = new Set<string>();
    for (const point of points) {
      const r = row(point.aspect);
      if (point.sentiment === "positive") {
        r.positive++;
        r.praise.push({ review, point });
        if (i !== -1) r.cells[i].positive++;
      } else {
        r.negative++;
        r.criticism.push({ review, point });
        if (i !== -1) r.cells[i].negative++;
      }
      touched.add(point.aspect);
    }
    for (const aspect of touched) rows.get(aspect)!.reviews++;
  }

  return Array.from(rows.values())
    .filter((r) => r.positive + r.negative > 0)
    .sort((a, b) => {
      if (a.aspect === OTHER_ASPECT) return 1;
      if (b.aspect === OTHER_ASPECT) return -1;
      return b.positive + b.negative - (a.positive + a.negative);
    });
}
