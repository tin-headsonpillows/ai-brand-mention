import type {
  BrandMentionEntry,
  ContentBreakdown,
  DomainLeaderboardEntry,
  KeywordDailySnapshot,
  KeywordHistory,
  MentionMoment,
  SurfaceBreakdown,
  TrackedBrand,
} from "./types";

function normalizeDomain(domain: string, brand: TrackedBrand): boolean {
  if (!brand.website.trim() || !domain) return false;
  const site = brand.website.toLowerCase().trim().replace(/^www\./, "");
  return domain === site || domain.endsWith(`.${site}`);
}

/** Cited-website leaderboard: every domain appearing in organic results or as an AI source, ranked by total exposure. */
export function computeDomainLeaderboard(histories: KeywordHistory[], brand: TrackedBrand): DomainLeaderboardEntry[] {
  const byDomain = new Map<
    string,
    { organicAppearances: number; positionSum: number; aiOverviewCitations: number; aiModeCitations: number; keywords: Set<string> }
  >();

  const bump = (domain: string, keyword: string) => {
    if (!domain) return null;
    let entry = byDomain.get(domain);
    if (!entry) {
      entry = { organicAppearances: 0, positionSum: 0, aiOverviewCitations: 0, aiModeCitations: 0, keywords: new Set() };
      byDomain.set(domain, entry);
    }
    entry.keywords.add(keyword);
    return entry;
  };

  for (const history of histories) {
    for (const day of history.days) {
      for (const r of day.organicResults) {
        const entry = bump(r.domain, history.keyword);
        if (entry) {
          entry.organicAppearances++;
          entry.positionSum += r.position;
        }
      }
      for (const s of day.aiOverview.sources) {
        const entry = bump(s.domain, history.keyword);
        if (entry) entry.aiOverviewCitations++;
      }
      for (const s of day.aiMode.sources) {
        const entry = bump(s.domain, history.keyword);
        if (entry) entry.aiModeCitations++;
      }
    }
  }

  const entries: DomainLeaderboardEntry[] = Array.from(byDomain.entries()).map(([domain, e]) => ({
    domain,
    isYourBrand: normalizeDomain(domain, brand),
    organicAppearances: e.organicAppearances,
    avgOrganicPosition: e.organicAppearances > 0 ? e.positionSum / e.organicAppearances : null,
    aiOverviewCitations: e.aiOverviewCitations,
    aiModeCitations: e.aiModeCitations,
    keywordsCitedIn: e.keywords.size,
  }));

  entries.sort(
    (a, b) =>
      b.organicAppearances + b.aiOverviewCitations + b.aiModeCitations -
      (a.organicAppearances + a.aiOverviewCitations + a.aiModeCitations)
  );
  return entries;
}

// Requires two-to-four consecutive Title-Case words (e.g. "Furama Resort Danang") so ordinary
// sentence-starters ("Based", "According") aren't picked up as brand names.
const NAME_PATTERN = /\b(?:[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\b/g;

// Generic SEO/UI boilerplate words that are never themselves a brand name - a candidate made
// entirely of these (e.g. "Official Site", "Search Results") is discarded.
const GENERIC_WORDS = new Set([
  "official", "site", "website", "home", "page", "search", "results", "review", "reviews",
  "guide", "about", "contact", "privacy", "policy", "terms", "service", "services", "overview",
  "mode", "top", "best", "based", "according",
]);

function extractNames(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(NAME_PATTERN)) {
    const name = match[0].trim();
    if (name.length < 4) continue;
    const words = name.toLowerCase().split(/\s+/);
    if (words.every((w) => GENERIC_WORDS.has(w))) continue;
    seen.add(name);
  }
  return Array.from(seen);
}

function isYourBrandName(name: string, brand: TrackedBrand): boolean {
  const terms = [brand.name, ...brand.aliases].filter(Boolean).map((t) => t.toLowerCase());
  const lower = name.toLowerCase();
  return terms.some((t) => lower.includes(t) || t.includes(lower));
}

/**
 * Approximates "which brands show up in the market" by pattern-matching capitalized name
 * sequences out of organic titles/snippets and AI answer text. This is a heuristic (no LLM
 * call, so it runs for free on every scheduled tracking run) and can pick up false positives -
 * treat counts as directional, not exact. Your own brand's count instead uses the same
 * name/alias/website matching already used for the visibility score, so that row is exact.
 */
export function computeBrandMentionLeaderboard(histories: KeywordHistory[], brand: TrackedBrand): BrandMentionEntry[] {
  const byName = new Map<string, { organic: number; aiOverview: number; aiMode: number }>();

  const bump = (name: string, surface: "organic" | "aiOverview" | "aiMode") => {
    const key = name.toLowerCase();
    const entry = byName.get(key) ?? { organic: 0, aiOverview: 0, aiMode: 0 };
    entry[surface]++;
    byName.set(key, entry);
  };
  const displayNames = new Map<string, string>();
  const rememberDisplay = (name: string) => {
    const key = name.toLowerCase();
    if (!displayNames.has(key)) displayNames.set(key, name);
  };

  let yourBrandOrganic = 0;
  let yourBrandAiOverview = 0;
  let yourBrandAiMode = 0;

  for (const history of histories) {
    for (const day of history.days) {
      if (day.brandHit.organic.matched) yourBrandOrganic++;
      if (day.brandHit.aiOverview.matched) yourBrandAiOverview++;
      if (day.brandHit.aiMode.matched) yourBrandAiMode++;

      for (const r of day.organicResults) {
        // Title and snippet are extracted separately (not concatenated) so a name split across
        // the boundary - e.g. title ending "...Reviews" + snippet starting "Hyatt Regency..." -
        // can't be picked up as a single spurious "Reviews Hyatt Regency" candidate.
        for (const name of [...extractNames(r.title), ...extractNames(r.snippet)]) {
          if (isYourBrandName(name, brand)) continue; // counted exactly via brandHit above
          rememberDisplay(name);
          bump(name, "organic");
        }
      }
      if (day.aiOverview.text) {
        for (const name of extractNames(day.aiOverview.text)) {
          if (isYourBrandName(name, brand)) continue;
          rememberDisplay(name);
          bump(name, "aiOverview");
        }
      }
      if (day.aiMode.text) {
        for (const name of extractNames(day.aiMode.text)) {
          if (isYourBrandName(name, brand)) continue;
          rememberDisplay(name);
          bump(name, "aiMode");
        }
      }
    }
  }

  const entries: BrandMentionEntry[] = Array.from(byName.entries()).map(([key, e]) => ({
    name: displayNames.get(key) ?? key,
    isYourBrand: false,
    mentionCount: e.organic + e.aiOverview + e.aiMode,
    organicMentions: e.organic,
    aiOverviewMentions: e.aiOverview,
    aiModeMentions: e.aiMode,
  }));

  if (brand.name.trim()) {
    entries.push({
      name: brand.name,
      isYourBrand: true,
      mentionCount: yourBrandOrganic + yourBrandAiOverview + yourBrandAiMode,
      organicMentions: yourBrandOrganic,
      aiOverviewMentions: yourBrandAiOverview,
      aiModeMentions: yourBrandAiMode,
    });
  }

  entries.sort((a, b) => b.mentionCount - a.mentionCount);
  return entries;
}

function emptyBreakdown(): SurfaceBreakdown {
  return { totalKeywordDays: 0, presentDays: 0, brandMatchedDays: 0, avgOrganicPosition: null, matchedByName: 0, matchedByAlias: 0, matchedByWebsite: 0 };
}

/** Per-surface stats: how often each surface renders at all, and how often your brand shows up in it. */
export function computeContentBreakdown(histories: KeywordHistory[]): ContentBreakdown {
  const organic = emptyBreakdown();
  const aiOverview = emptyBreakdown();
  const aiMode = emptyBreakdown();
  let organicPositionSum = 0;

  const tally = (b: SurfaceBreakdown, hit: KeywordDailySnapshot["brandHit"]["organic"], present: boolean) => {
    b.totalKeywordDays++;
    if (present) b.presentDays++;
    if (hit.matched) {
      b.brandMatchedDays++;
      if (hit.matchedBy.includes("name")) b.matchedByName++;
      if (hit.matchedBy.includes("alias")) b.matchedByAlias++;
      if (hit.matchedBy.includes("website")) b.matchedByWebsite++;
    }
  };

  for (const history of histories) {
    for (const day of history.days) {
      if (day.error) continue;
      tally(organic, day.brandHit.organic, day.organicResults.length > 0);
      tally(aiOverview, day.brandHit.aiOverview, day.aiOverview.present);
      tally(aiMode, day.brandHit.aiMode, day.aiMode.present);
      if (day.brandHit.organic.matched && day.brandHit.organic.organicPosition != null) {
        organicPositionSum += day.brandHit.organic.organicPosition;
      }
    }
  }

  organic.avgOrganicPosition = organic.brandMatchedDays > 0 ? organicPositionSum / organic.brandMatchedDays : null;
  return { organic, aiOverview, aiMode };
}

const EXCERPT_LENGTH = 220;

function excerptAround(text: string, needle: string): string {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return text.slice(0, EXCERPT_LENGTH);
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + needle.length + 140);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Recent, human-readable moments where the brand actually appeared, newest first - "how is it being discussed." */
export function collectBrandMentionMoments(histories: KeywordHistory[], brand: TrackedBrand, limit = 40): MentionMoment[] {
  const moments: MentionMoment[] = [];
  const needle = brand.name || brand.aliases[0] || "";

  for (const history of histories) {
    for (const day of history.days) {
      if (day.brandHit.organic.matched) {
        const result = day.organicResults.find((r) => r.position === day.brandHit.organic.organicPosition);
        if (result) {
          moments.push({
            date: day.date,
            keyword: history.keyword,
            surface: "organic",
            excerpt: `${result.title} — ${result.snippet}`.trim(),
            link: result.link,
            domain: result.domain,
          });
        }
      }
      if (day.brandHit.aiOverview.matched && day.aiOverview.text) {
        moments.push({
          date: day.date,
          keyword: history.keyword,
          surface: "aiOverview",
          excerpt: excerptAround(day.aiOverview.text, needle),
          link: day.aiOverview.sources[0]?.link ?? null,
          domain: null,
        });
      }
      if (day.brandHit.aiMode.matched && day.aiMode.text) {
        moments.push({
          date: day.date,
          keyword: history.keyword,
          surface: "aiMode",
          excerpt: excerptAround(day.aiMode.text, needle),
          link: day.aiMode.sources[0]?.link ?? null,
          domain: null,
        });
      }
    }
  }

  moments.sort((a, b) => b.date.localeCompare(a.date));
  return moments.slice(0, limit);
}
