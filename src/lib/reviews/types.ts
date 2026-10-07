/** Google Maps reviews (google_maps_reviews) or Google Hotels reviews (google_hotels_reviews, which also carries partner sources). */
export type ReviewSource = "maps" | "hotels";

export interface PlaceRef {
  source: ReviewSource;
  name: string;
  /** Google Maps data ID ("0x...:0x..."), for google_maps_reviews. */
  dataId?: string;
  placeId?: string;
  /** Google Hotels property token, for google_hotels_reviews. */
  propertyToken?: string;
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
  analysis?: ReviewAnalysis;
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
  address?: string;
  rating?: number;
  reviewCount?: number;
  thumbnail?: string;
  storedReviews: number;
  lastSyncedAt: string | null;
}

export type SyncEvent =
  | { type: "status"; message: string }
  | { type: "progress"; fetched: number; analyzed: number; pending: number; oldest: string | null }
  | { type: "done"; complete: boolean; fetched: number; analyzed: number }
  | { type: "error"; message: string };
