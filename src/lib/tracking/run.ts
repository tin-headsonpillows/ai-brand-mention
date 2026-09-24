import type { ServerKeyRotator } from "@/lib/serpKeyPool";
import { fetchAiMode, fetchAiOverview, fetchOrganicPage, type OrganicPage } from "./serpapi";
import { computeAiHit, computeOrganicHit } from "./visibility";
import type {
  AiTextSnapshot,
  KeywordDailySnapshot,
  OrganicResultSnapshot,
  TrackedBrand,
  TrackedKeyword,
  TrackingSettings,
} from "./types";

const EMPTY_AI: AiTextSnapshot = { present: false, text: null, sources: [] };
const EMPTY_HIT = { matched: false, matchedBy: [] as Array<"name" | "alias" | "website">, organicPosition: null };
const PAGE_SIZE = 10;
const PAGE_CONCURRENCY = 3;
/** Deep results keep title/link/domain; snippets are only stored where people actually read them. */
const SNIPPET_DEPTH = 20;
const STOPWORDS = new Set(["the", "and", "for", "with", "best", "top", "near", "from", "what", "how", "in", "of"]);

export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function linkKey(link: string): string {
  try {
    const u = new URL(link);
    u.hash = "";
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return link;
  }
}

/**
 * Google occasionally serves a SERP that has nothing to do with the query (we saw "bai tu long bay
 * cruises" come back as results for "tu"). If under a third of page 1 mentions any keyword term, the
 * page is treated as suspect and fetched once more, bypassing SerpApi's cache.
 */
function isLowRelevance(results: OrganicResultSnapshot[], keyword: string): boolean {
  const terms = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (terms.length === 0 || results.length < 3) return false;
  const relevant = results.filter((r) => {
    const text = `${r.title} ${r.snippet} ${r.link}`.toLowerCase();
    return terms.some((t) => text.includes(t));
  }).length;
  return relevant / results.length < 0.34;
}

/** Merges pages in order, drops results Google repeats across pages, and renumbers 1..N. */
function mergePages(pages: OrganicResultSnapshot[][], depth: number): OrganicResultSnapshot[] {
  const seen = new Set<string>();
  const merged: OrganicResultSnapshot[] = [];
  for (const page of pages) {
    for (const r of page) {
      const key = linkKey(r.link);
      if (seen.has(key)) continue;
      seen.add(key);
      const position = merged.length + 1;
      merged.push({ ...r, position, snippet: position <= SNIPPET_DEPTH ? r.snippet : "" });
      if (merged.length >= depth) return merged;
    }
  }
  return merged;
}

/** Runs one keyword through organic results (paged to the configured depth), AI Overview and AI Mode, and scores brand visibility. */
export async function trackKeyword(
  keyword: TrackedKeyword,
  settings: TrackingSettings,
  brand: TrackedBrand,
  rotator: ServerKeyRotator
): Promise<KeywordDailySnapshot> {
  const depth = settings.resultDepth ?? 10;
  const pageCount = Math.max(1, Math.ceil(depth / PAGE_SIZE));
  const fetchPage = (start: number, noCache = false) =>
    rotator.run((key) => fetchOrganicPage(keyword.keyword, settings, key, start, noCache));

  let searchesUsed = 0;
  try {
    let first: OrganicPage = await fetchPage(0);
    searchesUsed++;
    let lowRelevance = false;
    if (isLowRelevance(first.results, keyword.keyword)) {
      first = await fetchPage(0, true);
      searchesUsed++;
      lowRelevance = isLowRelevance(first.results, keyword.keyword);
    }

    // The AI Overview page_token expires about a minute after page 1, so redeem it before paging on.
    let aiOverview = EMPTY_AI;
    if (first.aiOverviewPageToken) {
      const token = first.aiOverviewPageToken;
      try {
        aiOverview = await rotator.run((key) => fetchAiOverview(token, key));
        searchesUsed++;
      } catch {
        // token expired or the overview failed to load - keep the rest of the run
      }
    }

    const pages: OrganicResultSnapshot[][] = [first.results];
    let more = first.hasNextPage;
    for (let p = 1; p < pageCount && more; p += PAGE_CONCURRENCY) {
      const starts: number[] = [];
      for (let i = p; i < Math.min(pageCount, p + PAGE_CONCURRENCY); i++) starts.push(i * PAGE_SIZE);
      try {
        const batch = await Promise.all(starts.map((start) => fetchPage(start)));
        searchesUsed += batch.length;
        for (const page of batch) pages.push(page.results);
        more = batch.every((page) => page.hasNextPage);
      } catch {
        // A deep page failing shouldn't discard the pages already fetched.
        searchesUsed += starts.length;
        more = false;
      }
    }
    const organicResults = mergePages(pages, depth);

    let aiMode = EMPTY_AI;
    try {
      aiMode = await rotator.run((key) => fetchAiMode(keyword.keyword, settings, key));
      searchesUsed++;
    } catch {
      // AI Mode is unavailable for some locales/queries; organic data is still worth keeping.
    }

    return {
      date: todayDateString(),
      organicResults,
      aiOverview,
      aiMode,
      brandHit: {
        organic: computeOrganicHit(organicResults, brand),
        aiOverview: computeAiHit(aiOverview, brand),
        aiMode: computeAiHit(aiMode, brand),
      },
      searchesUsed,
      resultDepth: depth,
      pagesFetched: pages.length,
      ...(first.showingResultsFor ? { showingResultsFor: first.showingResultsFor } : {}),
      ...(lowRelevance ? { lowRelevance } : {}),
    };
  } catch (err) {
    return {
      date: todayDateString(),
      organicResults: [],
      aiOverview: EMPTY_AI,
      aiMode: EMPTY_AI,
      brandHit: { organic: EMPTY_HIT, aiOverview: EMPTY_HIT, aiMode: EMPTY_HIT },
      searchesUsed,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
