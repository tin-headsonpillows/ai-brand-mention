import { fetchAiMode, fetchAiOverview, fetchOrganic } from "./serpapi";
import { computeAiHit, computeOrganicHit } from "./visibility";
import type { AiTextSnapshot, KeywordDailySnapshot, TrackedBrand, TrackedKeyword, TrackingSettings } from "./types";

const EMPTY_AI: AiTextSnapshot = { present: false, text: null, sources: [] };
const EMPTY_HIT = { matched: false, matchedBy: [] as Array<"name" | "alias" | "website">, organicPosition: null };

export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Runs one keyword through all three surfaces (organic, AI Overview, AI Mode) and scores brand visibility. */
export async function trackKeyword(
  keyword: TrackedKeyword,
  settings: TrackingSettings,
  brand: TrackedBrand,
  apiKey: string
): Promise<KeywordDailySnapshot> {
  let searchesUsed = 0;
  try {
    const { organicResults, aiOverviewPageToken } = await fetchOrganic(keyword.keyword, settings, apiKey);
    searchesUsed++;

    let aiOverview = EMPTY_AI;
    if (aiOverviewPageToken) {
      try {
        aiOverview = await fetchAiOverview(aiOverviewPageToken, apiKey);
        searchesUsed++;
      } catch {
        // page_token can expire between the two calls; leave AI Overview empty rather than failing the run.
      }
    }

    const aiMode = await fetchAiMode(keyword.keyword, settings, apiKey);
    searchesUsed++;

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
