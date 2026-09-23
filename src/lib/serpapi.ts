import type { SerpLocalResult } from "./types";

const SERPAPI_BASE_URL = "https://serpapi.com/search.json";

export function isSerpConfigured(userApiKey?: string): boolean {
  return !!userApiKey?.trim() || !!process.env.SERPAPI_API_KEY;
}

interface RawLocalResult {
  title?: unknown;
  name?: unknown;
  rating?: unknown;
  reviews?: unknown;
  address?: unknown;
  position?: unknown;
}

interface RawSerpResponse {
  local_results?: RawLocalResult[] | { places?: RawLocalResult[] };
  error?: string;
}

function normalizeLocalResults(raw: RawLocalResult[] | undefined): RawLocalResult[] {
  return Array.isArray(raw) ? raw : [];
}

async function fetchSerpEngine(
  engine: "google_local" | "google_maps",
  query: string,
  location: string,
  userApiKey?: string
): Promise<SerpLocalResult[]> {
  const apiKey = userApiKey?.trim() || process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({ engine, q: query, api_key: apiKey, hl: "en" });
  if (engine === "google_local") {
    params.set("location", location);
  } else {
    params.set("type", "search");
    params.set("location", location);
    params.set("z", "13");
  }

  const res = await fetch(`${SERPAPI_BASE_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`SerpApi ${engine} request failed with status ${res.status}`);
  }
  const data = (await res.json()) as RawSerpResponse;
  if (data.error) throw new Error(`SerpApi ${engine} error: ${data.error}`);

  const rawList = Array.isArray(data.local_results)
    ? data.local_results
    : normalizeLocalResults(data.local_results?.places);

  return rawList
    .map((r, i): SerpLocalResult => ({
      name: String(r.title ?? r.name ?? "").trim(),
      rating: typeof r.rating === "number" ? r.rating : null,
      reviews: typeof r.reviews === "number" ? r.reviews : null,
      address: typeof r.address === "string" ? r.address : null,
      position: typeof r.position === "number" ? r.position : i + 1,
      source: engine,
    }))
    .filter((r) => r.name.length > 0);
}

/** Fetches and merges Google Local + Google Maps results for a query/location, deduping by name. */
export async function fetchLocalResults(query: string, location: string, apiKey?: string): Promise<SerpLocalResult[]> {
  const [local, maps] = await Promise.all([
    fetchSerpEngine("google_local", query, location, apiKey).catch(() => [] as SerpLocalResult[]),
    fetchSerpEngine("google_maps", query, location, apiKey).catch(() => [] as SerpLocalResult[]),
  ]);
  return dedupe([...local, ...maps]);
}

function dedupe(results: SerpLocalResult[]): SerpLocalResult[] {
  const seen = new Map<string, SerpLocalResult>();
  for (const r of results) {
    const key = r.name.toLowerCase();
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values());
}

const MOCK_LOCAL_BUSINESSES: Array<Omit<SerpLocalResult, "position" | "source">> = [
  { name: "InterContinental Danang Sun Peninsula Resort", rating: 4.8, reviews: 3200, address: "Bai Bac, Son Tra Peninsula" },
  { name: "Furama Resort Danang", rating: 4.6, reviews: 5100, address: "68 Ho Xuan Huong St" },
  { name: "Hyatt Regency Danang Resort & Spa", rating: 4.6, reviews: 4300, address: "5 Truong Sa St" },
  { name: "Fusion Resort & Villas Danang", rating: 4.7, reviews: 1800, address: "Truong Sa St" },
  { name: "Pullman Danang Beach Resort", rating: 4.5, reviews: 3900, address: "101 Vo Nguyen Giap St" },
  { name: "Melia Danang Beach Resort", rating: 4.4, reviews: 2600, address: "19 Truong Sa St" },
];

/** Deterministic stand-in for SerpApi results when SERPAPI_API_KEY isn't set, so the comparison UI is testable. */
export function mockLocalResults(): SerpLocalResult[] {
  return MOCK_LOCAL_BUSINESSES.map((b, i) => ({ ...b, position: i + 1, source: "google_local" as const }));
}
