import { computeAiHit, computeOrganicHit } from "./visibility";
import type {
  BrandHit,
  ContentBreakdown,
  DomainLeaderboardEntry,
  KeywordDailySnapshot,
  KeywordHistory,
  MentionMoment,
  RankedSubject,
  SubjectDailyPoint,
  SubjectTrend,
  SurfaceBreakdown,
  TrackedBrand,
  TrackedCompetitor,
} from "./types";

function domainMatchesWebsite(domain: string, website: string): boolean {
  if (!website.trim() || !domain) return false;
  const site = website.toLowerCase().trim().replace(/^www\./, "");
  return domain === site || domain.endsWith(`.${site}`);
}

interface Subject {
  id: string;
  name: string;
  website: string;
  isYourBrand: boolean;
  colorSlot: number;
  def: TrackedBrand;
}

/** Your brand is always color slot 1; competitors cycle through the remaining 7 validated slots, by settings order (not by rank), so a subject's color never changes as data shifts. */
function buildSubjects(brand: TrackedBrand, competitors: TrackedCompetitor[]): Subject[] {
  return [
    { id: "you", name: brand.name || "Your brand", website: brand.website, isYourBrand: true, colorSlot: 1, def: brand },
    ...competitors.map((c, i): Subject => ({
      id: c.id,
      name: c.name || "(unnamed competitor)",
      website: c.website,
      isYourBrand: false,
      colorSlot: (i % 7) + 2,
      def: { name: c.name, aliases: c.aliases, website: c.website },
    })),
  ];
}

interface DayHits {
  organic: BrandHit;
  aiOverview: BrandHit;
  aiMode: BrandHit;
  matchedAny: boolean;
}

function hitsForSubject(day: KeywordDailySnapshot, def: TrackedBrand): DayHits {
  const organic = computeOrganicHit(day.organicResults, def);
  const aiOverview = computeAiHit(day.aiOverview, def);
  const aiMode = computeAiHit(day.aiMode, def);
  return { organic, aiOverview, aiMode, matchedAny: organic.matched || aiOverview.matched || aiMode.matched };
}

/**
 * Ranks your brand against user-selected competitors by re-matching each one's name/alias/website
 * against the organic results and AI text already stored in history - so adding a competitor in
 * settings applies retroactively to every day already tracked, with no new SerpApi calls.
 */
export function computeRankings(
  histories: KeywordHistory[],
  brand: TrackedBrand,
  competitors: TrackedCompetitor[]
): RankedSubject[] {
  const subjects = buildSubjects(brand, competitors);

  const ranked = subjects.map((s): RankedSubject => {
    let totalKeywordDays = 0;
    let matchedDays = 0;
    let organicMatchedDays = 0;
    let aiOverviewMatchedDays = 0;
    let aiModeMatchedDays = 0;
    let positionSum = 0;
    let positionCount = 0;

    for (const history of histories) {
      for (const day of history.days) {
        if (day.error) continue;
        totalKeywordDays++;
        const hits = hitsForSubject(day, s.def);
        if (hits.organic.matched) {
          organicMatchedDays++;
          if (hits.organic.organicPosition != null) {
            positionSum += hits.organic.organicPosition;
            positionCount++;
          }
        }
        if (hits.aiOverview.matched) aiOverviewMatchedDays++;
        if (hits.aiMode.matched) aiModeMatchedDays++;
        if (hits.matchedAny) matchedDays++;
      }
    }

    return {
      id: s.id,
      name: s.name,
      website: s.website,
      isYourBrand: s.isYourBrand,
      colorSlot: s.colorSlot,
      totalKeywordDays,
      matchedDays,
      visibilityPct: totalKeywordDays > 0 ? matchedDays / totalKeywordDays : 0,
      organicMatchedDays,
      aiOverviewMatchedDays,
      aiModeMatchedDays,
      avgOrganicPosition: positionCount > 0 ? positionSum / positionCount : null,
    };
  });

  ranked.sort((a, b) => b.visibilityPct - a.visibilityPct);
  return ranked;
}

/** Same subjects as computeRankings, but as a day-by-day series for trend charts. */
export function computeSubjectTrends(
  histories: KeywordHistory[],
  brand: TrackedBrand,
  competitors: TrackedCompetitor[]
): SubjectTrend[] {
  const subjects = buildSubjects(brand, competitors);

  return subjects.map((s): SubjectTrend => {
    const byDate = new Map<string, { matched: number; total: number; positionSum: number; positionCount: number }>();
    for (const history of histories) {
      for (const day of history.days) {
        if (day.error) continue;
        const entry = byDate.get(day.date) ?? { matched: 0, total: 0, positionSum: 0, positionCount: 0 };
        entry.total++;
        const hits = hitsForSubject(day, s.def);
        if (hits.matchedAny) entry.matched++;
        if (hits.organic.matched && hits.organic.organicPosition != null) {
          entry.positionSum += hits.organic.organicPosition;
          entry.positionCount++;
        }
        byDate.set(day.date, entry);
      }
    }

    const points: SubjectDailyPoint[] = Array.from(byDate.entries())
      .map(([date, e]) => ({
        date,
        visibilityPct: e.total > 0 ? e.matched / e.total : 0,
        avgOrganicPosition: e.positionCount > 0 ? e.positionSum / e.positionCount : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { id: s.id, name: s.name, isYourBrand: s.isYourBrand, colorSlot: s.colorSlot, points };
  });
}

/** Cited-website leaderboard: every domain appearing in organic results or as an AI source, ranked by total exposure. Excludes user-marked blogs/OTAs and flags domains that belong to a tracked competitor. */
export function computeDomainLeaderboard(
  histories: KeywordHistory[],
  brand: TrackedBrand,
  competitors: TrackedCompetitor[],
  excludedDomains: string[]
): DomainLeaderboardEntry[] {
  const excluded = excludedDomains.map((d) => d.toLowerCase().trim().replace(/^www\./, "")).filter(Boolean);
  const isExcluded = (domain: string) => excluded.some((ex) => domain === ex || domain.endsWith(`.${ex}`));

  const byDomain = new Map<
    string,
    { organicAppearances: number; positionSum: number; aiOverviewCitations: number; aiModeCitations: number; keywords: Set<string> }
  >();

  const bump = (domain: string, keyword: string) => {
    if (!domain || isExcluded(domain)) return null;
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

  const entries: DomainLeaderboardEntry[] = Array.from(byDomain.entries()).map(([domain, e]) => {
    const matchedCompetitor = competitors.find((c) => domainMatchesWebsite(domain, c.website));
    return {
      domain,
      isYourBrand: domainMatchesWebsite(domain, brand.website),
      isCompetitor: !!matchedCompetitor,
      competitorName: matchedCompetitor?.name ?? null,
      organicAppearances: e.organicAppearances,
      avgOrganicPosition: e.organicAppearances > 0 ? e.positionSum / e.organicAppearances : null,
      aiOverviewCitations: e.aiOverviewCitations,
      aiModeCitations: e.aiModeCitations,
      keywordsCitedIn: e.keywords.size,
    };
  });

  entries.sort(
    (a, b) =>
      b.organicAppearances + b.aiOverviewCitations + b.aiModeCitations -
      (a.organicAppearances + a.aiOverviewCitations + a.aiModeCitations)
  );
  return entries;
}

function emptyBreakdown(): SurfaceBreakdown {
  return { totalKeywordDays: 0, presentDays: 0, brandMatchedDays: 0, avgOrganicPosition: null, matchedByName: 0, matchedByAlias: 0, matchedByWebsite: 0 };
}

/** Per-surface stats for your own brand: how often each surface renders at all, and how often your brand shows up in it. */
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
