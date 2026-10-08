import { matchesBrand } from "../mentions";
import { OTHER_ASPECT } from "../reviews/analyze-shared";
import { listPlaces, readPlace } from "../reviews/store";
import { SOURCE_LABEL, type PlaceDoc, type PlaceSummary, type Review, type ReviewSource, type Sentiment as ReviewSentiment } from "../reviews/types";
import { domainMatchesWebsite } from "../tracking/analytics";
import type { TrackingConfig } from "../tracking/types";
import { brandTerms, type SuggestContext } from "./analyze";
import type { BrandSettings } from "./types";

/**
 * Customer reviews for Brand Mentions: the brand's own Google Maps / Tripadvisor / Google Hotels listings (from the
 * Reviews tab), summarised so they can sit next to what AI answers say.
 */

export type ListingRole = "brand" | "competitor" | "other";

export interface ListingRef {
  id: string;
  name: string;
  source: ReviewSource;
  sourceLabel: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  ranking?: string;
  stored: number;
  lastSyncedAt: string | null;
  role: ListingRole;
  /** Counted as the brand's own (chosen, or matched by name when nothing is chosen). */
  linked: boolean;
}

export interface AspectSummary {
  aspect: string;
  /** Reviews making this point. */
  count: number;
  /** Share of analysed reviews (0-100). */
  share: number;
  sources: ReviewSource[];
  quotes: string[];
}

export interface CustomerVoice {
  listings: ListingRef[];
  /** True when no listings were chosen and the brand's are matched by name. */
  auto: boolean;
  since: string | null;
  totals: {
    reviews: number;
    analysed: number;
    avgRating: number | null;
    /** 0-100 on the same scale as the AI perception score: positive 100, mixed/neutral 50, negative 0. */
    score: number | null;
    sentiment: Record<ReviewSentiment, number>;
    responseRate: number | null;
  };
  bySource: Array<{
    source: ReviewSource;
    label: string;
    reviews: number;
    avgRating: number | null;
    score: number | null;
    positiveShare: number | null;
    negativeShare: number | null;
    /** The rating and review count the site itself shows (all time). */
    publicRating?: number;
    publicCount?: number;
    ranking?: string;
  }>;
  praise: AspectSummary[];
  criticism: AspectSummary[];
  tripadvisor: {
    name: string;
    ranking?: string;
    rating?: number;
    reviews?: number;
    summary?: string;
    highlights: Array<{ category: string; value?: string; summary: string }>;
    subratings: Array<{ category: string; score: number }>;
    award?: { type: string; year?: string };
    link?: string;
  } | null;
  tripTypes: Array<{ type: string; count: number; avgRating: number | null; positiveShare: number | null }>;
  competitors: Array<{ name: string; source: ReviewSource; sourceLabel: string; rating?: number; reviewCount?: number; ranking?: string }>;
  lastSyncedAt: string | null;
}

const SENTIMENT_SCORE: Record<ReviewSentiment, number> = { positive: 100, mixed: 50, neutral: 50, negative: 0 };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v: number | null, digits = 1) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

function roleOf(place: PlaceSummary, config: TrackingConfig): ListingRole {
  const terms = brandTerms(config.brand);
  const domain = place.website?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  if ((terms.length && matchesBrand(place.name, terms)) || (domain && config.brand.website && domainMatchesWebsite(domain, config.brand.website))) {
    return "brand";
  }
  for (const c of config.competitors) {
    const cTerms = [c.name, ...c.aliases].map((t) => t.trim()).filter((t) => t.length > 1);
    if (cTerms.length && matchesBrand(place.name, cTerms)) return "competitor";
  }
  return "other";
}

/** The project's listings, each marked brand / competitor / other and whether it counts as the brand's own. */
export async function projectListings(projectId: string, config: TrackingConfig, settings: BrandSettings): Promise<{ listings: ListingRef[]; auto: boolean }> {
  const places = await listPlaces(projectId);
  const chosen = settings.reviewListings?.filter((id) => places.some((p) => p.id === id));
  const auto = !chosen || chosen.length === 0;
  return {
    auto,
    listings: places.map((p) => {
      const role = roleOf(p, config);
      return {
        id: p.id,
        name: p.name,
        source: p.source,
        sourceLabel: SOURCE_LABEL[p.source],
        address: p.address,
        rating: p.rating,
        reviewCount: p.reviewCount,
        ranking: p.ranking,
        stored: p.storedReviews,
        lastSyncedAt: p.lastSyncedAt,
        role,
        linked: auto ? role === "brand" : (chosen ?? []).includes(p.id),
      };
    }),
  };
}

function aspectSummaries(reviews: Array<Review & { from: ReviewSource }>, sentiment: "positive" | "negative", analysed: number): AspectSummary[] {
  const map = new Map<string, { label: string; ids: Set<string>; sources: Set<ReviewSource>; quotes: string[] }>();
  for (const r of reviews) {
    for (const p of r.analysis?.points ?? []) {
      if (p.sentiment !== sentiment || p.aspect === OTHER_ASPECT) continue;
      // Each listing has its own aspect names; the same name across listings is merged.
      const key = p.aspect.trim().toLowerCase();
      const entry = map.get(key) ?? { label: p.aspect, ids: new Set<string>(), sources: new Set<ReviewSource>(), quotes: [] };
      entry.ids.add(`${r.from}:${r.id}`);
      entry.sources.add(r.from);
      const quote = p.quote.trim();
      if (quote && entry.quotes.length < 3 && !entry.quotes.some((q) => q.toLowerCase() === quote.toLowerCase())) entry.quotes.push(quote);
      map.set(key, entry);
    }
  }
  return [...map.values()]
    .map((e) => ({ aspect: e.label, count: e.ids.size, share: share(e.ids.size, analysed) ?? 0, sources: [...e.sources], quotes: e.quotes }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function stats(reviews: Review[]) {
  const rated = reviews.filter((r) => r.rating !== null).map((r) => r.rating as number);
  const analysed = reviews.filter((r) => r.analysis);
  const counts: Record<ReviewSentiment, number> = { positive: 0, mixed: 0, neutral: 0, negative: 0 };
  for (const r of analysed) counts[r.analysis!.sentiment]++;
  return {
    avgRating: round(avg(rated), 2),
    score: round(avg(analysed.map((r) => SENTIMENT_SCORE[r.analysis!.sentiment]))),
    counts,
    analysed: analysed.length,
  };
}

/** Summary of the brand's own review listings since a date (null = all stored reviews). */
export async function customerVoice(projectId: string, config: TrackingConfig, settings: BrandSettings, since: string | null): Promise<CustomerVoice> {
  const { listings, auto } = await projectListings(projectId, config, settings);
  const linked = listings.filter((l) => l.linked);
  const docs = (await Promise.all(linked.map((l) => readPlace(l.id)))).filter((d): d is PlaceDoc => d !== null);
  const reviews = docs.flatMap((d) => d.reviews.filter((r) => !since || r.date >= since).map((r) => ({ ...r, from: d.place.source })));
  const all = stats(reviews);

  const bySource = (["maps", "tripadvisor", "hotels"] as ReviewSource[])
    .map((source) => {
      const ofSource = docs.filter((d) => d.place.source === source);
      if (!ofSource.length) return null;
      const rs = reviews.filter((r) => r.from === source);
      const st = stats(rs);
      const main = [...ofSource].sort((a, b) => (b.place.reviewCount ?? 0) - (a.place.reviewCount ?? 0))[0];
      return {
        source,
        label: SOURCE_LABEL[source],
        reviews: rs.length,
        avgRating: st.avgRating,
        score: st.score,
        positiveShare: share(st.counts.positive, st.analysed),
        negativeShare: share(st.counts.negative, st.analysed),
        publicRating: main.place.rating,
        publicCount: ofSource.reduce((s, d) => s + (d.place.reviewCount ?? 0), 0) || undefined,
        ranking: main.tripadvisor?.ranking,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const ta = docs.find((d) => d.tripadvisor);
  const tripTypes = new Map<string, Review[]>();
  for (const r of reviews) if (r.tripType) tripTypes.set(r.tripType, [...(tripTypes.get(r.tripType) ?? []), r]);

  const responded = reviews.filter((r) => r.response).length;
  return {
    listings,
    auto,
    since,
    totals: {
      reviews: reviews.length,
      analysed: all.analysed,
      avgRating: all.avgRating,
      score: all.score,
      sentiment: all.counts,
      responseRate: share(responded, reviews.length),
    },
    bySource,
    praise: aspectSummaries(reviews, "positive", all.analysed),
    criticism: aspectSummaries(reviews, "negative", all.analysed),
    tripadvisor: ta?.tripadvisor
      ? {
          name: ta.place.name,
          ranking: ta.tripadvisor.ranking,
          rating: ta.tripadvisor.rating,
          reviews: ta.tripadvisor.reviews,
          summary: ta.tripadvisor.summary,
          highlights: ta.tripadvisor.highlights.slice(0, 6).map(({ category, value, summary }) => ({ category, value, summary })),
          subratings: ta.tripadvisor.subratings,
          award: ta.tripadvisor.award,
          link: ta.tripadvisor.link,
        }
      : null,
    tripTypes: [...tripTypes.entries()]
      .map(([type, rs]) => {
        const st = stats(rs);
        return { type, count: rs.length, avgRating: st.avgRating, positiveShare: share(st.counts.positive, st.analysed) };
      })
      .sort((a, b) => b.count - a.count),
    competitors: listings
      .filter((l) => !l.linked && l.role === "competitor")
      .map((l) => ({ name: l.name, source: l.source, sourceLabel: l.sourceLabel, rating: l.rating, reviewCount: l.reviewCount, ranking: l.ranking })),
    lastSyncedAt: linked.map((l) => l.lastSyncedAt).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null,
  };
}

const TRAVELLERS: Record<string, string> = { couples: "couples", family: "families", friends: "groups of friends", business: "business travellers", solo: "solo travellers" };

/** Grounding for prompt suggestions: the brand's listings (category, location, ranking), audiences and what customers say. */
export async function suggestContext(projectId: string, config: TrackingConfig, settings: BrandSettings): Promise<SuggestContext> {
  const voice = await customerVoice(projectId, config, settings, new Date(Date.now() - 365 * 86_400_000).toISOString());
  return {
    listings: voice.listings
      .filter((l) => l.linked)
      .slice(0, 4)
      .map((l) => [l.name, l.sourceLabel, l.address, l.ranking].filter(Boolean).join(" · ")),
    praised: voice.praise.slice(0, 6).map((a) => a.aspect),
    criticised: voice.criticism.slice(0, 4).map((a) => a.aspect),
    travellers: voice.tripTypes.slice(0, 3).map((t) => TRAVELLERS[t.type.toLowerCase()] ?? t.type.toLowerCase()),
  };
}
