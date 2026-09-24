import type { AiTextSnapshot, OrganicResultSnapshot, SerpUsage, SourceRef, TrackingSettings } from "./types";

const BASE_URL = "https://serpapi.com/search.json";
const ACCOUNT_URL = "https://serpapi.com/account.json";

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

interface RawTextBlockItem {
  snippet?: unknown;
  title?: unknown;
}

interface RawTextBlock {
  type?: unknown;
  snippet?: unknown;
  list?: RawTextBlockItem[];
}

interface RawReference {
  title?: unknown;
  link?: unknown;
  source?: unknown;
}

function flattenTextBlocks(blocks: RawTextBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  const lines: string[] = [];
  for (const block of blocks) {
    if (typeof block.snippet === "string") lines.push(block.snippet);
    if (Array.isArray(block.list)) {
      for (const item of block.list) {
        const text = typeof item.snippet === "string" ? item.snippet : typeof item.title === "string" ? item.title : "";
        if (text) lines.push(`- ${text}`);
      }
    }
  }
  return lines.join("\n");
}

function mapReferences(refs: RawReference[] | undefined): SourceRef[] {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      link: typeof r.link === "string" ? r.link : "",
      domain: typeof r.link === "string" ? extractDomain(r.link) : "",
      ...(typeof r.source === "string" && r.source.trim() ? { source: r.source.trim() } : {}),
    }))
    .filter((r) => r.link);
}

function localeParams(settings: TrackingSettings): Record<string, string> {
  return { gl: settings.country, hl: settings.language, device: settings.device };
}

export interface OrganicPage {
  /** Positions as SerpApi reports them - they restart at 1 on every page, so callers renumber. */
  results: OrganicResultSnapshot[];
  aiOverviewPageToken: string | null;
  hasNextPage: boolean;
  showingResultsFor: string | null;
}

interface RawOrganicResult {
  position?: unknown;
  title?: unknown;
  link?: unknown;
  snippet?: unknown;
  source?: unknown;
}

interface RawOrganicResponse {
  organic_results?: RawOrganicResult[];
  ai_overview?: { page_token?: unknown };
  search_information?: { showing_results_for?: unknown; spelling_fix?: unknown };
  serpapi_pagination?: { next?: unknown };
  error?: string;
}

/**
 * Fetches one 10-result page of Google organic results (`start` = 0, 10, 20 ...) plus, on page 1, the
 * AI Overview stub token. Google no longer honours `num=100`, so deeper tracking means paging.
 */
export async function fetchOrganicPage(
  query: string,
  settings: TrackingSettings,
  apiKey: string,
  start: number,
  noCache = false
): Promise<OrganicPage> {
  const params = new URLSearchParams({ engine: "google", q: query, api_key: apiKey, ...localeParams(settings) });
  if (start > 0) params.set("start", String(start));
  if (noCache) params.set("no_cache", "true");
  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`SerpApi google request failed with status ${res.status}`);
  const data = (await res.json()) as RawOrganicResponse;
  if (data.error) {
    // Paging past the last result is a normal empty page, not a failure - throwing here would make the
    // key rotator treat it as a dead key and burn through every configured key.
    if (/hasn't returned any results/i.test(data.error)) {
      return { results: [], aiOverviewPageToken: null, hasNextPage: false, showingResultsFor: null };
    }
    throw new Error(`SerpApi google error: ${data.error}`);
  }

  const results: OrganicResultSnapshot[] = (data.organic_results ?? [])
    .map((r): OrganicResultSnapshot | null => {
      const link = typeof r.link === "string" ? r.link : "";
      if (!link) return null;
      return {
        position: typeof r.position === "number" ? r.position : 0,
        title: typeof r.title === "string" ? r.title : "",
        link,
        domain: extractDomain(link),
        snippet: typeof r.snippet === "string" ? r.snippet : "",
        ...(typeof r.source === "string" && r.source.trim() ? { source: r.source.trim() } : {}),
      };
    })
    .filter((r): r is OrganicResultSnapshot => r !== null);

  const info = data.search_information;
  const rewritten = typeof info?.showing_results_for === "string" ? info.showing_results_for : typeof info?.spelling_fix === "string" ? info.spelling_fix : null;

  return {
    results,
    aiOverviewPageToken: typeof data.ai_overview?.page_token === "string" ? data.ai_overview.page_token : null,
    hasNextPage: typeof data.serpapi_pagination?.next === "string" && results.length > 0,
    showingResultsFor: rewritten,
  };
}

interface RawAiOverviewResponse {
  ai_overview?: { text_blocks?: RawTextBlock[]; references?: RawReference[] };
  error?: string;
}

/** Redeems an AI Overview page_token (expires ~1 minute after the organic search) for the full AI Overview content. */
export async function fetchAiOverview(pageToken: string, apiKey: string): Promise<AiTextSnapshot> {
  const params = new URLSearchParams({ engine: "google_ai_overview", page_token: pageToken, api_key: apiKey });
  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`SerpApi google_ai_overview request failed with status ${res.status}`);
  const data = (await res.json()) as RawAiOverviewResponse;
  if (data.error) throw new Error(`SerpApi google_ai_overview error: ${data.error}`);

  const blocks = data.ai_overview?.text_blocks;
  const text = flattenTextBlocks(blocks);
  return {
    present: text.length > 0,
    text: text || null,
    sources: mapReferences(data.ai_overview?.references),
  };
}

interface RawAiModeResponse {
  text_blocks?: RawTextBlock[];
  references?: RawReference[];
  error?: string;
}

/** Fetches Google's AI Mode answer for a query directly (single call, no stub/redeem step). */
export async function fetchAiMode(query: string, settings: TrackingSettings, apiKey: string): Promise<AiTextSnapshot> {
  const params = new URLSearchParams({
    engine: "google_ai_mode",
    q: query,
    api_key: apiKey,
    gl: settings.country,
    hl: settings.language,
  });
  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`SerpApi google_ai_mode request failed with status ${res.status}`);
  const data = (await res.json()) as RawAiModeResponse;
  if (data.error) throw new Error(`SerpApi google_ai_mode error: ${data.error}`);

  const text = flattenTextBlocks(data.text_blocks);
  return {
    present: text.length > 0,
    text: text || null,
    sources: mapReferences(data.references),
  };
}

interface RawAccountResponse {
  plan_id?: unknown;
  plan_searches_left?: unknown;
  extra_credits?: unknown;
  total_searches_left?: unknown;
  this_month_usage?: unknown;
  searches_per_month?: unknown;
}

/** Fetches SerpApi's own account quota (the real "searches used/left" numbers, not a token estimate). */
export async function fetchAccountUsage(apiKey: string): Promise<SerpUsage> {
  const params = new URLSearchParams({ api_key: apiKey });
  const res = await fetch(`${ACCOUNT_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(`SerpApi account request failed with status ${res.status}`);
  const data = (await res.json()) as RawAccountResponse;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    fetchedAt: new Date().toISOString(),
    planId: typeof data.plan_id === "string" ? data.plan_id : null,
    planSearchesLeft: num(data.plan_searches_left),
    extraCreditsLeft: num(data.extra_credits),
    totalSearchesLeft: num(data.total_searches_left),
    thisMonthUsage: num(data.this_month_usage),
    searchesPerMonth: num(data.searches_per_month),
    mock: false,
    activeKeyIndex: null,
    keyPoolSize: 1,
  };
}

/** Reports usage for whichever configured key still has searches left, so the UI reflects the key actually in use. */
export async function fetchActiveAccountUsage(keys: string[]): Promise<SerpUsage> {
  let last: SerpUsage | null = null;
  for (let i = 0; i < keys.length; i++) {
    const usage = await fetchAccountUsage(keys[i]);
    last = usage;
    const left = usage.totalSearchesLeft ?? usage.planSearchesLeft ?? 0;
    if (left > 0) return { ...usage, activeKeyIndex: i, keyPoolSize: keys.length };
  }
  if (!last) throw new Error("No SerpApi keys configured");
  return { ...last, activeKeyIndex: keys.length - 1, keyPoolSize: keys.length };
}
