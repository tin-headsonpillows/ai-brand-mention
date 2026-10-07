import { DEFAULT_MODEL, isMockMode } from "../openai";
import { runWithConcurrency } from "../concurrency";
import { analysisText, analyzeBatch, analyzeHeuristic, buildTaxonomy, heuristicTaxonomy } from "./analyze";
import { monthsBefore } from "./dates";
import { FETCH_VERSION, looksTruncated } from "./coverage";
import { SORT_ORDERS, fetchReviewsPage } from "./serpapi";
import { readPlace, writePlace } from "./store";
import type { PlaceDoc, Review, SyncEvent } from "./types";

/** Leave room under the route's 300 s limit for the final save. */
const FETCH_BUDGET_MS = 170_000;
const TOTAL_BUDGET_MS = 230_000;
const SAVE_EVERY_PAGES = 4;
const ANALYZE_BATCH = 15;
const ANALYZE_CONCURRENCY = 5;
/** A refresh page with this many already-stored reviews means we've caught up. */
const REFRESH_KNOWN_THRESHOLD = 3;
/** An extra sort-order pass gives up after this many pages in a row bring nothing new. */
const EXTRA_EMPTY_PAGES = 3;
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
  const now = new Date();
  // monthsBack 0 = the business's whole review history.
  const cutoff = doc.settings.monthsBack > 0 ? monthsBefore(now, doc.settings.monthsBack).toISOString() : null;
  const version = doc.fetch.version ?? 1;
  if (doc.fetch.phase === "done" && version < 2) {
    // Fetched by the first logic, which could stop early on an out-of-order review: walk the history again.
    // Stored reviews are skipped, so this only re-spends the pages already fetched.
    doc.fetch = { phase: "backfill", nextPageToken: null, pagesFetched: 0, version: FETCH_VERSION };
  } else if (doc.fetch.phase === "done" && version < FETCH_VERSION) {
    // The newest-first pass is complete; places where Google cut that list short get the extra passes.
    doc.fetch = looksTruncated(doc, cutoff)
      ? { phase: "extra", nextPageToken: null, pagesFetched: 0, sortIndex: 1, emptyPages: 0, version: FETCH_VERSION }
      : { ...doc.fetch, version: FETCH_VERSION };
  } else if (refresh && doc.fetch.phase === "done") {
    doc.fetch = { phase: "refresh", nextPageToken: null, pagesFetched: 0, version: FETCH_VERSION };
  }

  // --- Fetch -----------------------------------------------------------------------------------
  const sorts = SORT_ORDERS[doc.place.source];
  const known = new Set(doc.reviews.map((r) => r.id));
  let addedThisRefresh = 0;
  let pagesSinceSave = 0;

  const announce = () => {
    if (doc.fetch.phase === "done") return;
    emit({
      type: "status",
      message:
        doc.fetch.phase === "refresh"
          ? "Checking for new reviews..."
          : doc.fetch.phase === "extra"
            ? `Google stopped listing newest reviews early - collecting the rest sorted by ${sorts[doc.fetch.sortIndex ?? 1]?.label}...`
            : "Fetching reviews, newest first...",
    });
  };
  announce();
  while (doc.fetch.phase !== "done" && Date.now() - started < FETCH_BUDGET_MS && !isAborted()) {
    let page;
    try {
      page = await fetchReviewsPage(doc.place, doc.fetch.nextPageToken, now, doc.fetch.phase === "extra" ? (doc.fetch.sortIndex ?? 1) : 0);
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

    // Google's "newest first" isn't strictly ordered - an old review that was recently edited can sit among
    // new ones - so a single out-of-window or already-stored review never ends the fetch on its own.
    let stop = !page.nextPageToken || page.reviews.length === 0;
    let knownOnPage = 0;
    let outsideWindow = 0;
    let added = 0;
    for (const review of page.reviews) {
      if (known.has(review.id)) {
        knownOnPage++;
        continue;
      }
      if ((doc.fetch.phase === "backfill" || doc.fetch.phase === "extra") && cutoff && review.date < cutoff) {
        outsideWindow++;
        continue;
      }
      if ((doc.fetch.phase === "backfill" || doc.fetch.phase === "extra") && doc.reviews.length >= doc.settings.maxReviews) {
        stop = true;
        break;
      }
      known.add(review.id);
      doc.reviews.push(review);
      added++;
      if (doc.fetch.phase === "refresh") addedThisRefresh++;
    }
    const pageSize = page.reviews.length;
    // Backfill: most of the page predates the window. (A lone old review is an out-of-order edit, and stored
    // reviews say nothing about where the window ends, so neither counts.)
    if (doc.fetch.phase === "backfill" && pageSize > 0 && outsideWindow * 2 >= pageSize) stop = true;
    // Refresh: caught up once a page is mostly reviews we already have, or brings nothing new.
    if (doc.fetch.phase === "refresh" && (added === 0 || knownOnPage >= REFRESH_KNOWN_THRESHOLD)) stop = true;
    if (doc.fetch.phase === "refresh" && addedThisRefresh >= doc.settings.maxReviews) stop = true;
    doc.reviews.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    // Extra passes aren't date-ordered: they end when the list does, when enough pages in a row add nothing,
    // or once coverage is reached - never on dates.
    let nextPass = false;
    if (doc.fetch.phase === "extra") {
      doc.fetch.emptyPages = added === 0 ? (doc.fetch.emptyPages ?? 0) + 1 : 0;
      const capped = doc.reviews.length >= doc.settings.maxReviews;
      if (capped || !looksTruncated(doc, cutoff)) stop = true;
      else if (stop || (doc.fetch.emptyPages ?? 0) >= EXTRA_EMPTY_PAGES) {
        stop = false;
        nextPass = true;
      }
    } else if (doc.fetch.phase === "backfill" && stop && !page.nextPageToken && looksTruncated(doc, cutoff)) {
      // Google ended the newest-first list short of the total: switch to the other sort orders.
      stop = false;
      nextPass = true;
    }

    if (nextPass) {
      const nextIndex = doc.fetch.phase === "extra" ? (doc.fetch.sortIndex ?? 1) + 1 : 1;
      if (nextIndex < sorts.length) {
        doc.fetch = { phase: "extra", nextPageToken: null, pagesFetched: doc.fetch.pagesFetched, sortIndex: nextIndex, emptyPages: 0, version: FETCH_VERSION };
        announce();
      } else {
        stop = true;
      }
    }
    if (stop) {
      doc.fetch = { phase: "done", nextPageToken: null, pagesFetched: doc.fetch.pagesFetched, version: FETCH_VERSION };
      doc.lastSyncedAt = now.toISOString();
    } else if (!nextPass) {
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
      let lastError = "";
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
            } catch (err) {
              failures++;
              lastError = err instanceof Error ? err.message : String(err);
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
          if (failures > 0) {
            emit({
              type: "error",
              message: `The OpenAI analysis failed: ${lastError.slice(0, 200)}. Reviews are saved; press "Finish analysis" once the OpenAI key works.`,
            });
            break;
          }
          // The model answered but keeps leaving these out (typically emoji-only, one-word or very long
          // reviews): give them the keyword analysis rather than leaving them pending forever.
          for (const review of todo) {
            if (!review.analysis) review.analysis = { ...analyzeHeuristic(review), fallback: true };
          }
          emit(progress(doc));
          await writePlace(doc);
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
