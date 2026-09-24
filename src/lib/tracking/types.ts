export interface TrackingSettings {
  /** Google `hl` parameter, e.g. "en" */
  language: string;
  /** Google `gl` parameter, e.g. "us" */
  country: string;
  device: "desktop" | "tablet" | "mobile";
}

export interface TrackedKeyword {
  id: string;
  keyword: string;
  active: boolean;
  createdAt: string;
}

export interface TrackedBrand {
  name: string;
  aliases: string[];
  /** Root domain, e.g. "furamavietnam.com" (no protocol/www) */
  website: string;
}

export interface TrackedCompetitor {
  id: string;
  name: string;
  aliases: string[];
  /** Root domain, e.g. "marriott.com" (no protocol/www) */
  website: string;
}

export interface TrackingConfig {
  settings: TrackingSettings;
  keywords: TrackedKeyword[];
  brand: TrackedBrand;
  /** User-selected brands to rank against yours - applied retroactively to already-collected history, no extra API calls. */
  competitors: TrackedCompetitor[];
  /** Domains (blogs, OTAs, forums, ...) to hide from the cited-websites leaderboard, e.g. "reddit.com". */
  excludedDomains: string[];
}

export interface SourceRef {
  title: string;
  link: string;
  domain: string;
}

export interface OrganicResultSnapshot {
  position: number;
  title: string;
  link: string;
  domain: string;
  snippet: string;
}

export interface AiTextSnapshot {
  present: boolean;
  text: string | null;
  sources: SourceRef[];
}

export interface BrandHit {
  matched: boolean;
  matchedBy: Array<"name" | "alias" | "website">;
  organicPosition: number | null;
}

export interface KeywordDailySnapshot {
  date: string;
  organicResults: OrganicResultSnapshot[];
  aiOverview: AiTextSnapshot;
  aiMode: AiTextSnapshot;
  brandHit: {
    organic: BrandHit;
    aiOverview: BrandHit;
    aiMode: BrandHit;
  };
  searchesUsed: number;
  error?: string;
}

export interface KeywordHistory {
  keywordId: string;
  keyword: string;
  days: KeywordDailySnapshot[];
}

export interface SerpUsage {
  fetchedAt: string;
  planId: string | null;
  planSearchesLeft: number | null;
  extraCreditsLeft: number | null;
  totalSearchesLeft: number | null;
  thisMonthUsage: number | null;
  searchesPerMonth: number | null;
  mock: boolean;
  /** Index into the configured key pool of the key currently serving requests, if known. */
  activeKeyIndex: number | null;
  keyPoolSize: number;
}

export interface RunResult {
  date: string;
  ranAt: string;
  keywordResults: Array<{ keywordId: string; keyword: string; searchesUsed: number; error?: string }>;
  totalSearchesUsed: number;
  mock: boolean;
}
