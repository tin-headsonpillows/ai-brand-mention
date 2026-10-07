import { hasServerApiKeys } from "../serpKeyPool";
import { serpRequest as serp } from "../serpRequest";
import { parseRelativeDate } from "./dates";
import type { PlaceRef, Review, ReviewSource } from "./types";

type Json = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);

/** Without server keys the tab runs on generated data, so the whole flow stays testable. */
export function isReviewsMock(): boolean {
  return !hasServerApiKeys();
}

// ---------------------------------------------------------------------------------------------
// Finding the business
// ---------------------------------------------------------------------------------------------

/** Pulls the data ID (and name) out of a pasted Google Maps link. */
export function parseMapsUrl(input: string): { dataId: string; name?: string } | null {
  const id = input.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
  if (!id) return null;
  const name = input.match(/\/maps\/place\/([^/@]+)/)?.[1];
  return { dataId: id, name: name ? decodeURIComponent(name.replace(/\+/g, " ")) : undefined };
}

function mapsCandidate(r: Json): PlaceRef | null {
  const dataId = str(r.data_id);
  const name = str(r.title);
  if (!dataId || !name) return null;
  return {
    source: "maps",
    name,
    dataId,
    placeId: str(r.place_id),
    address: str(r.address),
    rating: num(r.rating),
    reviewCount: num(r.reviews),
    type: str(r.type),
    thumbnail: str(r.thumbnail),
    website: str(r.website),
  };
}

function hotelCandidate(r: Json): PlaceRef | null {
  const propertyToken = str(r.property_token);
  const name = str(r.name);
  if (!propertyToken || !name) return null;
  const images = arr(r.images);
  return {
    source: "hotels",
    name,
    propertyToken,
    address: str(r.address) ?? str(r.description),
    rating: num(r.overall_rating),
    reviewCount: num(r.reviews),
    type: str(r.hotel_class) ?? str(r.type),
    thumbnail: str(images[0]?.thumbnail),
    website: str(r.link),
  };
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Candidate businesses for a name/query (or a pasted Maps link) on the chosen review source. */
export async function searchPlaces(query: string, source: ReviewSource): Promise<PlaceRef[]> {
  const q = query.trim();
  if (!q) return [];
  if (isReviewsMock()) return mockCandidates(q, source);

  if (source === "maps") {
    const fromUrl = parseMapsUrl(q);
    if (fromUrl) {
      // The reviews endpoint returns place_info, so the name/rating fill in on the first sync.
      return [{ source: "maps", name: fromUrl.name ?? "Google Maps place", dataId: fromUrl.dataId }];
    }
    const data = await serp({ engine: "google_maps", type: "search", q, hl: "en" });
    const single = mapsCandidate(obj(data.place_results));
    if (single) return [single];
    return arr(data.local_results)
      .map(mapsCandidate)
      .filter((p): p is PlaceRef => p !== null)
      .slice(0, 10);
  }

  const data = await serp({
    engine: "google_hotels",
    q,
    check_in_date: isoDay(14),
    check_out_date: isoDay(15),
    hl: "en",
    gl: "us",
    currency: "USD",
  });
  const single = hotelCandidate(data);
  if (single) return [single];
  return arr(data.properties)
    .map(hotelCandidate)
    .filter((p): p is PlaceRef => p !== null)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------

export interface ReviewsPage {
  reviews: Review[];
  nextPageToken: string | null;
  /** Fresh place details (Maps returns them with every page). */
  placeInfo?: Partial<PlaceRef>;
  topics?: Array<{ keyword: string; mentions: number }>;
}

/** Small stable hash for reviews that come without an ID (Google Hotels). */
function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `h${(h >>> 0).toString(36)}`;
}

function numericRatings(v: unknown): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj(v))) {
    if (typeof value === "number" && value >= 1 && value <= 5) out[key.replace(/_/g, " ")] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function mapsReview(r: Json, now: Date): Review | null {
  const id = str(r.review_id);
  const date = str(r.iso_date) ?? parseRelativeDate(str(r.date), now);
  if (!id || !date) return null;
  const extracted = obj(r.extracted_snippet);
  const text = str(extracted.original) ?? str(r.snippet) ?? "";
  const translated = str(extracted.translated);
  const user = obj(r.user);
  const response = obj(r.response);
  const responseExtracted = obj(response.extracted_snippet);
  const responseText = str(responseExtracted.original) ?? str(response.snippet);
  return {
    id,
    date,
    dateApprox: !str(r.iso_date),
    rating: num(r.rating) ?? null,
    text,
    ...(translated && translated !== text ? { textEn: translated } : {}),
    author: str(user.name) ?? "Anonymous",
    authorLink: str(user.link),
    source: str(r.source) ?? "Google",
    link: str(r.link),
    likes: num(r.likes),
    subratings: numericRatings(r.details),
    ...(responseText ? { response: { date: str(response.iso_date), text: responseText } } : {}),
  };
}

function hotelReview(r: Json, now: Date): Review | null {
  const date = parseRelativeDate(str(r.date), now);
  if (!date) return null;
  const user = obj(r.user);
  const text = str(r.snippet) ?? "";
  const source = str(r.source) ?? "Google";
  const author = str(user.name) ?? "Anonymous";
  const rating = num(r.rating);
  const best = num(r.best_rating) ?? 5;
  const response = obj(r.response);
  const responseText = str(response.snippet);
  const responseDate = parseRelativeDate(str(response.date), now);
  return {
    id: hashId(`${source}|${author}|${text.slice(0, 160)}|${rating ?? ""}`),
    date,
    dateApprox: true,
    rating: rating !== undefined ? Math.round((rating / best) * 5 * 10) / 10 : null,
    text,
    author,
    authorLink: str(user.link),
    source,
    link: str(r.link),
    subratings: numericRatings(r.subratings),
    ...(responseText ? { response: { date: responseDate ?? undefined, text: responseText } } : {}),
  };
}

/**
 * Sort orders per source, newest first. Google often stops listing a place's "newest" reviews well before
 * its total (SerpApi: "the total number of reviews returned may vary depending on the sorting option"), so
 * the other orders are walked afterwards to pick up the rest.
 */
export const SORT_ORDERS: Record<ReviewSource, Array<{ value: string; label: string }>> = {
  maps: [
    { value: "newestFirst", label: "newest" },
    { value: "ratingLow", label: "lowest rated" },
    { value: "ratingHigh", label: "highest rated" },
    { value: "qualityScore", label: "most relevant" },
  ],
  hotels: [
    { value: "2", label: "newest" },
    { value: "4", label: "lowest rated" },
    { value: "3", label: "highest rated" },
    { value: "1", label: "most helpful" },
  ],
};

/** One page of reviews in the given sort order (newest first by default). Each call is one SerpApi search. */
export async function fetchReviewsPage(
  place: PlaceRef,
  pageToken: string | null,
  now = new Date(),
  sortIndex = 0
): Promise<ReviewsPage> {
  if (isReviewsMock()) return mockReviewsPage(place, pageToken, now, sortIndex);
  const sort = (SORT_ORDERS[place.source][sortIndex] ?? SORT_ORDERS[place.source][0]).value;

  if (place.source === "maps") {
    const params: Record<string, string> = { engine: "google_maps_reviews", sort_by: sort, hl: "en" };
    if (place.dataId) params.data_id = place.dataId;
    else if (place.placeId) params.place_id = place.placeId;
    else throw new Error("This place has no Google Maps ID");
    // `num` isn't allowed on the first page (it always returns 8); later pages take up to 20.
    if (pageToken) {
      params.next_page_token = pageToken;
      params.num = "20";
    }
    const data = await serp(params);
    const info = obj(data.place_info);
    return {
      reviews: arr(data.reviews)
        .map((r) => mapsReview(r, now))
        .filter((r): r is Review => r !== null),
      nextPageToken: str(obj(data.serpapi_pagination).next_page_token) ?? null,
      placeInfo: {
        name: str(info.title),
        address: str(info.address),
        rating: num(info.rating),
        reviewCount: num(info.reviews),
        type: str(info.type),
      },
      topics: arr(data.topics)
        .map((t) => ({ keyword: str(t.keyword) ?? "", mentions: num(t.mentions) ?? 0 }))
        .filter((t) => t.keyword),
    };
  }

  if (!place.propertyToken) throw new Error("This hotel has no Google Hotels property token");
  const params: Record<string, string> = {
    engine: "google_hotels_reviews",
    property_token: place.propertyToken,
    sort_by: sort,
    hl: "en",
  };
  if (pageToken) params.next_page_token = pageToken;
  const data = await serp(params);
  return {
    reviews: arr(data.reviews)
      .map((r) => hotelReview(r, now))
      .filter((r): r is Review => r !== null),
    nextPageToken: str(obj(data.serpapi_pagination).next_page_token) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Mock data (no SerpApi keys configured)
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockCandidates(query: string, source: ReviewSource): PlaceRef[] {
  const base = query.replace(/\b\w/g, (c) => c.toUpperCase());
  return [base, `${base} Beach Resort`, `${base} Riverside Hotel`].map((name, i) => ({
    source,
    name,
    ...(source === "maps" ? { dataId: `0xmock:0x${i}${hashId(name)}` } : { propertyToken: `mock-${i}-${hashId(name)}` }),
    address: "123 Vo Nguyen Giap, Da Nang, Vietnam",
    rating: 4.6 - i * 0.2,
    reviewCount: 2400 - i * 600,
    type: "Hotel",
  }));
}

const MOCK_PRAISE = [
  "The staff were incredibly friendly and helpful.",
  "Breakfast buffet had great variety.",
  "Our room was spotless and the bed very comfortable.",
  "Amazing ocean view from the balcony.",
  "Location is perfect, right on the beach.",
  "The pool area is beautiful and well kept.",
  "Great value for money.",
  "Check-in was quick and smooth.",
];
const MOCK_CRITICISM = [
  "The room smelled musty and the bathroom was not clean.",
  "Wifi kept dropping in the room.",
  "Breakfast was crowded and food ran out.",
  "Staff at reception were rude when we asked for help.",
  "Very noisy at night because of construction next door.",
  "Overpriced for what you get.",
  "Check-in took over an hour.",
  "The pool was closed for maintenance.",
];
const MOCK_PAGE_SIZE = 20;
const MOCK_TOTAL = 360;
const MOCK_NEWEST_LISTED = 240;

function mockReviewsPage(place: PlaceRef, pageToken: string | null, now: Date, sortIndex = 0): ReviewsPage {
  const page = pageToken ? Number(pageToken.replace("mock-page-", "")) : 0;
  if (sortIndex > 0) {
    // Other sort orders: the full set, in a different order (here: oldest first), like Google's rating sorts.
    const all: Review[] = [];
    for (let p = 0; p * MOCK_PAGE_SIZE < MOCK_TOTAL; p++) all.push(...mockReviewsPage(place, p ? `mock-page-${p}` : null, now, -1).reviews);
    all.reverse();
    const slice = all.slice(page * MOCK_PAGE_SIZE, (page + 1) * MOCK_PAGE_SIZE);
    return {
      reviews: slice,
      nextPageToken: (page + 1) * MOCK_PAGE_SIZE < all.length ? `mock-page-${page + 1}` : null,
    };
  }
  const seed = Number.parseInt(hashId(place.name).slice(1), 36);
  const reviews: Review[] = [];
  for (let i = page * MOCK_PAGE_SIZE; i < Math.min(MOCK_TOTAL, (page + 1) * MOCK_PAGE_SIZE); i++) {
    const rng = mulberry32(seed + i * 7919);
    // Reviews get sparser further back; a rough patch around 4-5 months ago tilts negative.
    // Like real Google data, one recently edited old review sits out of order near the top.
    const daysAgo = i === 12 ? 1000 : Math.floor(i * 1.25 + rng() * 1.5);
    const date = new Date(now.getTime() - daysAgo * 86_400_000);
    const roughPatch = daysAgo > 120 && daysAgo < 160;
    const negativeChance = roughPatch ? 0.55 : 0.2;
    const sentences: string[] = [];
    let score = 0;
    const count = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < count; k++) {
      if (rng() < negativeChance) {
        sentences.push(MOCK_CRITICISM[Math.floor(rng() * MOCK_CRITICISM.length)]);
        score--;
      } else {
        sentences.push(MOCK_PRAISE[Math.floor(rng() * MOCK_PRAISE.length)]);
        score++;
      }
    }
    const rating = Math.max(1, Math.min(5, 4 + score + (rng() < 0.3 ? -1 : 0)));
    reviews.push({
      id: `mock-${i}`,
      date: date.toISOString(),
      dateApprox: place.source === "hotels",
      rating,
      text: Array.from(new Set(sentences)).join(" "),
      author: `Guest ${i + 1}`,
      source: place.source === "hotels" && rng() < 0.3 ? "Tripadvisor" : "Google",
      subratings:
        place.source === "hotels"
          ? { rooms: Math.max(1, rating - (rng() < 0.3 ? 1 : 0)), service: rating, location: 5 }
          : undefined,
      ...(rng() < 0.45 ? { response: { date: new Date(date.getTime() + 2 * 86_400_000).toISOString(), text: "Thank you for your feedback." } } : {}),
    });
  }
  // Like Google, the "newest" list ends early (sortIndex -1 = the full set, used by the other mock orders).
  const listed = sortIndex === -1 ? MOCK_TOTAL : MOCK_NEWEST_LISTED;
  const hasMore = (page + 1) * MOCK_PAGE_SIZE < listed;
  return {
    reviews,
    nextPageToken: hasMore ? `mock-page-${page + 1}` : null,
    placeInfo: { rating: 4.4, reviewCount: MOCK_TOTAL },
    topics:
      place.source === "maps"
        ? [
            { keyword: "breakfast", mentions: 84 },
            { keyword: "pool", mentions: 61 },
            { keyword: "beach", mentions: 57 },
            { keyword: "staff", mentions: 44 },
          ]
        : [],
  };
}
