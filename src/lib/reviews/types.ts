/**
 * Google Maps reviews (google_maps_reviews), Google Hotels reviews (google_hotels_reviews, which also carries partner
 * sources) or Tripadvisor (tripadvisor_reviews + tripadvisor_place).
 */
export type ReviewSource = "maps" | "hotels" | "tripadvisor";

export const SOURCE_LABEL: Record<ReviewSource, string> = {
  maps: "Google Maps",
  hotels: "Google Hotels",
  tripadvisor: "Tripadvisor",
};

export interface PlaceRef {
  source: ReviewSource;
  name: string;
  /** Google Maps data ID ("0x...:0x..."), for google_maps_reviews. */
  dataId?: string;
  placeId?: string;
  /** Google Hotels property token, for google_hotels_reviews. */
  propertyToken?: string;
  /** Tripadvisor location ID (the number after "-d" in its URLs), for tripadvisor_reviews. */
  tripadvisorId?: string;
  /** Link to the listing on its own site. */
  link?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  type?: string;
  thumbnail?: string;
  website?: string;
}

export type Sentiment = "positive" | "negative" | "mixed" | "neutral";

/** One specific point of praise or criticism inside a review. */
export interface ReviewPoint {
  aspect: string;
  sentiment: "positive" | "negative";
  /** Short phrase from the review (English) that carries the point. */
  quote: string;
}

export interface ReviewAnalysis {
  sentiment: Sentiment;
  points: ReviewPoint[];
  /** Set when the model kept skipping this review and the keyword method stood in. */
  fallback?: boolean;
}

export interface Review {
  id: string;
  /** Headline the reviewer gave (Tripadvisor). */
  title?: string;
  /** ISO timestamp. Google Hotels only reports relative dates ("2 weeks ago"), so those are approximate. */
  date: string;
  dateApprox: boolean;
  /** Normalised to a 1-5 scale (partner sources rate out of 10). */
  rating: number | null;
  /** Review text as written. */
  text: string;
  /** Google's English translation when the review is in another language. */
  textEn?: string;
  author: string;
  authorLink?: string;
  /** "Google", or a partner site for hotel reviews (e.g. "Tripadvisor"). */
  source: string;
  link?: string;
  likes?: number;
  /** Per-aspect star ratings Google collects (e.g. rooms / service / location, or food / service / atmosphere). */
  subratings?: Record<string, number>;
  response?: { date?: string; text: string };
  /** Who the reviewer travelled with (Tripadvisor: Couples, Family, Friends, Business, Solo). */
  tripType?: string;
  /** Language code of the review as written (Tripadvisor). */
  language?: string;
  analysis?: ReviewAnalysis;
}

/** A Tripadvisor listing's own profile data (tripadvisor_place): ranking, category scores, AI summary, highlights. */
export interface TripadvisorProfile {
  fetchedAt: string;
  type?: string;
  rating?: number;
  reviews?: number;
  /** e.g. "#12 of 1,873 hotels in Paris". */
  ranking?: string;
  /** Category scores out of 5 (Location, Rooms, Value, Cleanliness, Service, Sleep Quality, Food...). */
  subratings: Array<{ category: string; score: number }>;
  /** Review counts by rating label (Excellent ... Terrible). */
  distribution: Array<{ label: string; count: number }>;
  /** Tripadvisor's AI-generated summary of the reviews. */
  summary?: string;
  /** Tripadvisor's review highlights per category, with quotes. */
  highlights: Array<{ category: string; value?: string; summary: string; quotes: string[] }>;
  award?: { type: string; year?: string };
  stars?: string;
  /** Traveller styles the listing ranks for (e.g. Romantic, Family, Value). */
  styles: Array<{ tag: string; ranking?: number }>;
  amenities: string[];
  priceLevel?: string;
  link?: string;
}

export interface PlaceSettings {
  /** How far back the first fetch goes; 0 = all history. */
  monthsBack: number;
  /** Hard cap on stored reviews, to bound SerpApi usage. */
  maxReviews: number;
}

export interface FetchState {
  /**
   * backfill: first pass, newest first, walking back in time; extra: further passes in other sort orders,
   * because Google stops listing "newest" before the end for many places; refresh: picking up new
   * reviews; done: idle.
   */
  phase: "backfill" | "extra" | "refresh" | "done";
  nextPageToken: string | null;
  pagesFetched: number;
  /** extra phase: which alternative sort order is being walked (index into the source's sort list). */
  sortIndex?: number;
  /** extra phase: consecutive pages that brought nothing new. */
  emptyPages?: number;
  /** Version of the fetch logic that last completed a pass (older passes may have stopped early). */
  version?: number;
}

export interface PlaceDoc {
  id: string;
  /** Google Search Tracking projects this business belongs to (missing on older docs = the default project). */
  projectIds?: string[];
  place: PlaceRef;
  settings: PlaceSettings;
  createdAt: string;
  lastSyncedAt: string | null;
  fetch: FetchState;
  /** The aspects reviews are sorted into, fixed once per place so periods stay comparable. */
  taxonomy: string[];
  /** Google Maps' own review topics (keyword + mention count across all reviews). */
  topics: Array<{ keyword: string; mentions: number }>;
  /** Tripadvisor listings: the profile, refreshed with each sync. */
  tripadvisor?: TripadvisorProfile;
  analyzer: "openai" | "heuristic" | null;
  /** SerpApi searches spent on this place so far. */
  searchesUsed: number;
  reviews: Review[];
}

export interface PlaceSummary {
  id: string;
  projectIds?: string[];
  name: string;
  source: ReviewSource;
  dataId?: string;
  placeId?: string;
  propertyToken?: string;
  tripadvisorId?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  thumbnail?: string;
  /** Tripadvisor ranking line, when known. */
  ranking?: string;
  website?: string;
  storedReviews: number;
  lastSyncedAt: string | null;
}

export type SyncEvent =
  | { type: "status"; message: string }
  | { type: "progress"; fetched: number; analyzed: number; pending: number; oldest: string | null }
  | { type: "done"; complete: boolean; fetched: number; analyzed: number }
  | { type: "error"; message: string };
