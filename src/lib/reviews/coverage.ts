import { monthsBefore } from "./dates";
import type { PlaceDoc } from "./types";

/**
 * Version of the fetch logic. 2: no early stop on out-of-order reviews. 3: extra passes in other sort orders
 * when Google ends the newest-first list short of the total. Places completed by an older version get the
 * missing steps on their next fetch.
 */
export const FETCH_VERSION = 3;
/** Stored reviews counted as "complete" against Google's total (rating-only/removed reviews never list). */
const COVERAGE_TARGET = 0.97;

/** How many reviews a complete fetch should hold: Google's total, bounded by the cap. */
export function fetchTarget(doc: PlaceDoc): number | null {
  const total = doc.place.reviewCount;
  return total ? Math.min(total, doc.settings.maxReviews) : null;
}

/**
 * Whether the stored reviews fall short of what the window should hold. All history: compared with Google's
 * total. A window: the newest-first stream should reach back to its start - judged on the 97th percentile
 * date, so a few out-of-order (edited) reviews don't count as coverage.
 */
export function looksTruncated(doc: PlaceDoc, cutoff: string | null): boolean {
  if (doc.reviews.length >= doc.settings.maxReviews) return false;
  if (!cutoff) {
    const target = fetchTarget(doc);
    return target !== null && doc.reviews.length < target * COVERAGE_TARGET;
  }
  if (doc.reviews.length === 0) return false;
  const reach = doc.reviews[Math.min(doc.reviews.length - 1, Math.floor(doc.reviews.length * 0.97))].date;
  const monthAfterCutoff = new Date(Date.parse(cutoff) + 30 * 86_400_000).toISOString();
  return reach > monthAfterCutoff;
}


/** The window's start for a place's settings (null = all history). */
export function windowCutoff(doc: PlaceDoc, now = new Date()): string | null {
  return doc.settings.monthsBack > 0 ? monthsBefore(now, doc.settings.monthsBack).toISOString() : null;
}
