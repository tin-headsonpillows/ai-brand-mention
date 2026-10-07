import { DEFAULT_MODEL, isMockMode } from "../openai";
import { runWithConcurrency } from "../concurrency";
import { analysisText, analyzeBatch, analyzeHeuristic, buildTaxonomy, heuristicTaxonomy } from "./analyze";
import { monthsBefore } from "./dates";
import { fetchReviewsPage } from "./serpapi";
import { readPlace, writePlace } from "./store";
import type { PlaceDoc, Review, SyncEvent } from "./types";

/** Leave room under the route's 300 s limit for the final save. */
const FETCH_BUDGET_MS = 170_000;
const TOTAL_BUDGET_MS = 230_000;
const SAVE_EVERY_PAGES = 4;
const ANALYZE_BATCH = 15;
const ANALYZE_CONCURRENCY = 5;

function pending(doc: PlaceDoc): Review[] {
  return doc.reviews.filter((r) => !r.analysis);
}

function progress(doc: PlaceDoc): SyncEvent {
  return {
    type: "progress",
    fetched: doc.reviews.length,
    analyzed: doc.reviews.length - pending(doc).length,
    pending: pending(doc).length,
    oldest: doc.reviews.length ? doc.reviews[doc.reviews.length - 1].date : null,
  };
}

/**
 * One time-boxed slice of work on a place: fetch review pages (newest first) until the history window,
 * the review cap or the time budget is reached, then analyse whatever is still unanalysed. The client
 * calls again while `complete` is false, so a large backfill spans several requests without hitting
 * the function timeout, and every slice's work is saved as it goes.
 */
export async function syncPlace(
  id: string,
  refresh: boolean,
  emit: (event: SyncEvent) => void,
  isAborted: () => boolean
): Promise<void> {
  const started = Date.now();
  const doc = await readPlace(id);
  if (!doc) {
    emit({ type: "error", message: "Unknown business" });
    return;
  }
  const before = { fetched: doc.reviews.length, analyzed: doc.reviews.length - pending(doc).length };
  if (refresh && doc.fetch.phase === "done") doc.fetch = { phase: "refresh", nextPageToken: null, pagesFetched: 0 };

  // --- Fetch -----------------------------------------------------------------------------------
  const now = new Date();
  const cutoff = monthsBefore(now, doc.settings.monthsBack).toISOString();
  const known = new Set(doc.reviews.map((r) => r.id));
  let addedThisRefresh = 0;
  let pagesSinceSave = 0;

  if (doc.fetch.phase !== "done") {
    emit({
      type: "status",
      message: doc.fetch.phase === "refresh" ? "Checking for new reviews..." : "Fetching reviews, newest first...",
    });
  }
  while (doc.fetch.phase !== "done" && Date.now() - started < FETCH_BUDGET_MS && !isAborted()) {
    let page;
    try {
      page = await fetchReviewsPage(doc.place, doc.fetch.nextPageToken, now);
    } catch (err) {
      emit({ type: "error", message: err instanceof Error ? err.message : "Fetching reviews failed" });
      break;
    }
    doc.searchesUsed++;
    doc.fetch.pagesFetched++;
    if (page.placeInfo) {
      for (const [key, value] of Object.entries(page.placeInfo)) {
        if (value !== undefined) (doc.place as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if (page.topics?.length) doc.topics = page.topics;

    let stop = !page.nextPageToken || page.reviews.length === 0;
    for (const review of page.reviews) {
      if (known.has(review.id)) {
        // A refresh has caught up with what's stored.
        if (doc.fetch.phase === "refresh") stop = true;
        continue;
      }
      if (doc.fetch.phase === "backfill" && review.date < cutoff) {
        stop = true;
        continue;
      }
      if (doc.fetch.phase === "backfill" && doc.reviews.length >= doc.settings.maxReviews) {
        stop = true;
        break;
      }
      known.add(review.id);
      doc.reviews.push(review);
      if (doc.fetch.phase === "refresh") addedThisRefresh++;
    }
    if (doc.fetch.phase === "refresh" && addedThisRefresh >= doc.settings.maxReviews) stop = true;
    doc.reviews.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    if (stop) {
      doc.fetch = { phase: "done", nextPageToken: null, pagesFetched: doc.fetch.pagesFetched };
      doc.lastSyncedAt = now.toISOString();
    } else {
      doc.fetch.nextPageToken = page.nextPageToken;
    }
    emit(progress(doc));
    if (++pagesSinceSave >= SAVE_EVERY_PAGES || stop) {
      await writePlace(doc);
      pagesSinceSave = 0;
    }
  }
  if (pagesSinceSave > 0) await writePlace(doc);

  // --- Analyse ---------------------------------------------------------------------------------
  const useModel = !isMockMode();
  if (!doc.analyzer) doc.analyzer = useModel ? "openai" : "heuristic";

  if (pending(doc).length > 0 && !isAborted()) {
    if (doc.analyzer === "heuristic") {
      if (doc.taxonomy.length === 0) doc.taxonomy = heuristicTaxonomy();
      for (const review of pending(doc)) review.analysis = analyzeHeuristic(review);
      emit(progress(doc));
      await writePlace(doc);
    } else {
      if (doc.taxonomy.length === 0) {
        emit({ type: "status", message: "Working out what customers talk about..." });
        doc.taxonomy = await buildTaxonomy(
          doc.place,
          doc.reviews.filter((r) => analysisText(r)),
          doc.topics,
          DEFAULT_MODEL
        );
        await writePlace(doc);
      }
      emit({ type: "status", message: "Analysing sentiment and points of praise or criticism..." });
      let failures = 0;
      while (pending(doc).length > 0 && Date.now() - started < TOTAL_BUDGET_MS && !isAborted()) {
        const todo = pending(doc).slice(0, ANALYZE_BATCH * ANALYZE_CONCURRENCY);
        const batches: Review[][] = [];
        for (let i = 0; i < todo.length; i += ANALYZE_BATCH) batches.push(todo.slice(i, i + ANALYZE_BATCH));
        let analyzedThisRound = 0;
        await runWithConcurrency(
          batches,
          ANALYZE_CONCURRENCY,
          async (batch) => {
            try {
              return await analyzeBatch(batch, doc.taxonomy, DEFAULT_MODEL);
            } catch {
              failures++;
              return new Map();
            }
          },
          (results) => {
            for (const review of doc.reviews) {
              const analysis = results.get(review.id);
              if (analysis && !review.analysis) {
                review.analysis = analysis;
                analyzedThisRound++;
              }
            }
          },
          isAborted
        );
        emit(progress(doc));
        await writePlace(doc);
        if (analyzedThisRound === 0) {
          emit({
            type: "error",
            message: failures > 0 ? "The analysis model returned errors - try again shortly." : "Some reviews could not be analysed.",
          });
          break;
        }
      }
    }
  }

  const fetched = doc.reviews.length;
  const analyzed = fetched - pending(doc).length;
  emit({
    type: "done",
    complete: doc.fetch.phase === "done" && pending(doc).length === 0,
    fetched: fetched - before.fetched,
    analyzed: analyzed - before.analyzed,
  });
}
