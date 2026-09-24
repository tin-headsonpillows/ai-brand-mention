import { todayDateString } from "./run";
import { computeAiHit, computeOrganicHit } from "./visibility";
import type { AiTextSnapshot, KeywordDailySnapshot, OrganicResultSnapshot, SerpUsage, TrackedBrand } from "./types";

const MOCK_COMPETITORS = [
  "InterContinental Danang Sun Peninsula Resort",
  "Hyatt Regency Danang Resort & Spa",
  "Pullman Danang Beach Resort",
  "Danang Marriott Resort & Spa",
];

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Deterministic stand-in for a full SerpApi tracking run when SERPAPI_API_KEY isn't set. */
export function mockTrackKeyword(keyword: string, brand: TrackedBrand): KeywordDailySnapshot {
  const rng = mulberry32(hashCode(keyword + brand.name));
  const pool = [brand.name || "Your Brand", ...MOCK_COMPETITORS].filter(Boolean);
  const shuffled = [...pool].sort(() => rng() - 0.5);

  const organicResults: OrganicResultSnapshot[] = shuffled.map((name, i) => ({
    position: i + 1,
    title: `${name} - Official Site & Reviews`,
    link: `https://${slug(name)}.example.com/`,
    domain: `${slug(name)}.example.com`,
    snippet: `${name} is a top-rated choice for "${keyword}" based on recent guest reviews.`,
  }));

  const mentionedInAi = shuffled.slice(0, 3);
  const aiText = `Based on traveler reviews, top picks for "${keyword}" include ${mentionedInAi.join(", ")}.`;
  const aiOverview: AiTextSnapshot = {
    present: true,
    text: aiText,
    sources: mentionedInAi.map((name) => ({
      title: name,
      link: `https://${slug(name)}.example.com/`,
      domain: `${slug(name)}.example.com`,
    })),
  };
  const aiMode: AiTextSnapshot = { ...aiOverview, text: `${aiText} Results may vary by traveler preference and season.` };

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
    searchesUsed: 0,
  };
}

export function mockAccountUsage(): SerpUsage {
  return {
    fetchedAt: new Date().toISOString(),
    planId: "free",
    planSearchesLeft: 87,
    extraCreditsLeft: 0,
    totalSearchesLeft: 87,
    thisMonthUsage: 13,
    searchesPerMonth: 100,
    mock: true,
    activeKeyIndex: null,
    keyPoolSize: 0,
  };
}
