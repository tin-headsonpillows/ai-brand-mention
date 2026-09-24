import { computeAiHit, computeOrganicHit } from "./visibility";
import type {
  AiTextSnapshot,
  BrandHit,
  KeywordDailySnapshot,
  KeywordHistory,
  OrganicResultSnapshot,
  TrackedBrand,
  TrackedCompetitor,
} from "./types";

export type Surface = "organic" | "aiOverview" | "aiMode";
export type SurfaceFilter = "all" | Surface;
export type AiSurface = "aiOverview" | "aiMode";

export const SURFACES: Surface[] = ["organic", "aiOverview", "aiMode"];
export const SURFACE_LABEL: Record<Surface, string> = {
  organic: "Organic results",
  aiOverview: "AI Overview",
  aiMode: "AI Mode",
};

function surfacesIn(filter: SurfaceFilter): Surface[] {
  return filter === "all" ? SURFACES : [filter];
}

export interface Subject {
  id: string;
  name: string;
  website: string;
  isYourBrand: boolean;
  /** Stable 1-8 categorical slot tied to identity (your brand = 1, competitors by settings order), never to rank. */
  colorSlot: number;
  def: TrackedBrand;
}

export function buildSubjects(brand: TrackedBrand, competitors: TrackedCompetitor[]): Subject[] {
  return [
    { id: "you", name: brand.name || "Your brand", website: brand.website, isYourBrand: true, colorSlot: 1, def: brand },
    ...competitors
      .filter((c) => c.name.trim() || c.website.trim())
      .map((c, i): Subject => ({
        id: c.id,
        name: c.name || c.website,
        website: c.website,
        isYourBrand: false,
        colorSlot: (i % 7) + 2,
        def: { name: c.name, aliases: c.aliases, website: c.website },
      })),
  ];
}

export function seriesColor(slot: number): string {
  return `var(--series-${slot})`;
}

export function domainMatchesWebsite(domain: string, website: string): boolean {
  if (!website.trim() || !domain) return false;
  const site = website.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return domain === site || domain.endsWith(`.${site}`);
}

export interface DayHits {
  organic: BrandHit;
  aiOverview: BrandHit;
  aiMode: BrandHit;
  /**
   * Where the subject's own website ranks organically. A name mention inside someone else's result
   * (e.g. a TripAdvisor listicle) counts toward visibility but is not the brand's rank; only when no
   * website is configured does the first name-matching result stand in for position.
   */
  organicPosition: number | null;
}

export type HitLookup = (day: KeywordDailySnapshot, subjectIndex: number) => DayHits;

/**
 * Name/alias/website matching is regex-heavy, and every view asks the same (day, subject) question,
 * so results are memoized per day object. Range filtering keeps the same day objects, so the cache
 * survives filter changes and only resets when the subject list (brand/competitors) changes.
 */
export function createHitLookup(subjects: Subject[]): HitLookup {
  const cache = new WeakMap<KeywordDailySnapshot, DayHits[]>();
  return (day, si) => {
    let row = cache.get(day);
    if (!row) {
      row = [];
      cache.set(day, row);
    }
    let hits = row[si];
    if (!hits) {
      const subject = subjects[si];
      const organic = computeOrganicHit(day.organicResults, subject.def);
      const ownResults = subject.website.trim()
        ? day.organicResults.filter((r) => domainMatchesWebsite(r.domain, subject.website)).map((r) => r.position)
        : [];
      hits = {
        organic,
        aiOverview: computeAiHit(day.aiOverview, subject.def),
        aiMode: computeAiHit(day.aiMode, subject.def),
        organicPosition: subject.website.trim()
          ? ownResults.length > 0
            ? Math.min(...ownResults)
            : null
          : organic.matched
            ? organic.organicPosition
            : null,
      };
      row[si] = hits;
    }
    return hits;
  };
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function filterByRange(histories: KeywordHistory[], rangeDays: number | null): KeywordHistory[] {
  if (rangeDays == null) return histories;
  const cutoff = isoDaysAgo(rangeDays - 1);
  return histories.map((h) => ({ ...h, days: h.days.filter((d) => d.date >= cutoff) }));
}

export function collectDates(histories: KeywordHistory[]): string[] {
  const dates = new Set<string>();
  for (const h of histories) for (const d of h.days) if (!d.error) dates.add(d.date);
  return Array.from(dates).sort();
}

function citationsIn(day: KeywordDailySnapshot, website: string, surfaces: Surface[]): number {
  if (!website.trim()) return 0;
  let n = 0;
  if (surfaces.includes("organic")) n += day.organicResults.filter((r) => domainMatchesWebsite(r.domain, website)).length;
  if (surfaces.includes("aiOverview")) n += day.aiOverview.sources.filter((s) => domainMatchesWebsite(s.domain, website)).length;
  if (surfaces.includes("aiMode")) n += day.aiMode.sources.filter((s) => domainMatchesWebsite(s.domain, website)).length;
  return n;
}

export interface SubjectDay {
  date: string;
  keywords: number;
  matched: number;
  visibility: number | null;
  positionSum: number;
  positionSamples: number;
  avgPosition: number | null;
  mentions: number;
  citations: number;
  share: number | null;
}

export interface SubjectSeries {
  subject: Subject;
  days: SubjectDay[];
}

/** Per-subject, per-day visibility, organic position, mentions, citations and share of voice. */
export function computeSubjectSeries(
  histories: KeywordHistory[],
  subjects: Subject[],
  hits: HitLookup,
  filter: SurfaceFilter
): { dates: string[]; series: SubjectSeries[] } {
  const dates = collectDates(histories);
  const surfaces = surfacesIn(filter);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const acc = subjects.map(() =>
    dates.map(() => ({ keywords: 0, matched: 0, positionSum: 0, positionSamples: 0, mentions: 0, citations: 0 }))
  );

  for (const h of histories) {
    for (const day of h.days) {
      if (day.error) continue;
      const di = dateIndex.get(day.date);
      if (di == null) continue;
      subjects.forEach((s, si) => {
        const a = acc[si][di];
        const dh = hits(day, si);
        const matchedSurfaces = surfaces.filter((surface) => dh[surface].matched).length;
        a.keywords++;
        if (matchedSurfaces > 0) a.matched++;
        a.mentions += matchedSurfaces;
        if (dh.organicPosition != null) {
          a.positionSum += dh.organicPosition;
          a.positionSamples++;
        }
        a.citations += citationsIn(day, s.website, surfaces);
      });
    }
  }

  const totalMentions = dates.map((_, di) => acc.reduce((sum, rows) => sum + rows[di].mentions, 0));

  const series = subjects.map((subject, si) => ({
    subject,
    days: dates.map((date, di): SubjectDay => {
      const a = acc[si][di];
      return {
        date,
        ...a,
        visibility: a.keywords > 0 ? a.matched / a.keywords : null,
        avgPosition: a.positionSamples > 0 ? a.positionSum / a.positionSamples : null,
        share: totalMentions[di] > 0 ? a.mentions / totalMentions[di] : null,
      };
    }),
  }));

  return { dates, series };
}

export interface SubjectSummary {
  subject: Subject;
  keywordDays: number;
  visibility: number;
  avgPosition: number | null;
  mentions: number;
  citations: number;
  share: number;
}

/** Whole-period totals per subject, for the rankings table. */
export function summarizeSeries(series: SubjectSeries[]): SubjectSummary[] {
  const totalMentions = series.reduce((sum, s) => sum + s.days.reduce((n, d) => n + d.mentions, 0), 0);
  return series.map(({ subject, days }) => {
    const keywordDays = days.reduce((n, d) => n + d.keywords, 0);
    const matched = days.reduce((n, d) => n + d.matched, 0);
    const positionSum = days.reduce((n, d) => n + d.positionSum, 0);
    const positionSamples = days.reduce((n, d) => n + d.positionSamples, 0);
    const mentions = days.reduce((n, d) => n + d.mentions, 0);
    return {
      subject,
      keywordDays,
      visibility: keywordDays > 0 ? matched / keywordDays : 0,
      avgPosition: positionSamples > 0 ? positionSum / positionSamples : null,
      mentions,
      citations: days.reduce((n, d) => n + d.citations, 0),
      share: totalMentions > 0 ? mentions / totalMentions : 0,
    };
  });
}

export interface PeriodMetric {
  value: number | null;
  /** Second half of the period minus the first half (equal-length halves). */
  delta: number | null;
}

export interface PeriodMetrics {
  visibility: PeriodMetric;
  avgPosition: PeriodMetric;
  share: PeriodMetric;
  mentions: PeriodMetric;
  citations: PeriodMetric;
  halfDays: number;
}

type Aggregate = Record<Exclude<keyof PeriodMetrics, "halfDays">, number | null>;

function aggregateDays(series: SubjectSeries[], si: number, from: number, to: number): Aggregate {
  let keywords = 0;
  let matched = 0;
  let positionSum = 0;
  let positionSamples = 0;
  let mentions = 0;
  let citations = 0;
  let allMentions = 0;
  series.forEach((s, i) => {
    for (const d of s.days.slice(from, to)) {
      allMentions += d.mentions;
      if (i !== si) continue;
      keywords += d.keywords;
      matched += d.matched;
      positionSum += d.positionSum;
      positionSamples += d.positionSamples;
      mentions += d.mentions;
      citations += d.citations;
    }
  });
  return {
    visibility: keywords > 0 ? matched / keywords : null,
    avgPosition: positionSamples > 0 ? positionSum / positionSamples : null,
    share: allMentions > 0 ? mentions / allMentions : null,
    mentions: keywords > 0 ? mentions : null,
    citations: keywords > 0 ? citations : null,
  };
}

/**
 * Headline numbers for a panel: the value over the whole selected period, and its trend as the
 * second half of the period vs the first half - steadier than comparing two single days.
 */
export function periodMetrics(series: SubjectSeries[], si: number): PeriodMetrics {
  const n = series[si]?.days.length ?? 0;
  const half = Math.floor(n / 2);
  const all = aggregateDays(series, si, 0, n);
  const early = half > 0 ? aggregateDays(series, si, 0, half) : null;
  const late = half > 0 ? aggregateDays(series, si, n - half, n) : null;
  const metric = (k: keyof Aggregate): PeriodMetric => {
    const a = early?.[k];
    const b = late?.[k];
    return { value: all[k], delta: a != null && b != null ? b - a : null };
  };
  return {
    visibility: metric("visibility"),
    avgPosition: metric("avgPosition"),
    share: metric("share"),
    mentions: metric("mentions"),
    citations: metric("citations"),
    halfDays: half,
  };
}

export interface SurfaceSplit {
  dates: string[];
  visibility: Record<Surface, Array<number | null>>;
  /** Share of searches where the surface rendered at all (organic results existed, an AI Overview / AI Mode answer showed). */
  presence: Record<Surface, number>;
  overall: Record<Surface, number>;
}

/** Your brand's visibility split by surface, plus how often each surface appears at all. */
export function computeSurfaceSplit(histories: KeywordHistory[], hits: HitLookup): SurfaceSplit {
  const dates = collectDates(histories);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const perDay = dates.map(() => ({ total: 0, organic: 0, aiOverview: 0, aiMode: 0 }));
  let total = 0;
  const presentCount: Record<Surface, number> = { organic: 0, aiOverview: 0, aiMode: 0 };
  const matchedCount: Record<Surface, number> = { organic: 0, aiOverview: 0, aiMode: 0 };

  for (const h of histories) {
    for (const day of h.days) {
      if (day.error) continue;
      const di = dateIndex.get(day.date);
      if (di == null) continue;
      const dh = hits(day, 0);
      total++;
      perDay[di].total++;
      if (day.organicResults.length > 0) presentCount.organic++;
      if (day.aiOverview.present) presentCount.aiOverview++;
      if (day.aiMode.present) presentCount.aiMode++;
      for (const s of SURFACES) {
        if (dh[s].matched) {
          perDay[di][s]++;
          matchedCount[s]++;
        }
      }
    }
  }

  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);
  const series = (s: Surface) => perDay.map((p) => (p.total > 0 ? p[s] / p.total : null));
  return {
    dates,
    visibility: { organic: series("organic"), aiOverview: series("aiOverview"), aiMode: series("aiMode") },
    presence: {
      organic: ratio(presentCount.organic, total),
      aiOverview: ratio(presentCount.aiOverview, total),
      aiMode: ratio(presentCount.aiMode, total),
    },
    overall: {
      organic: ratio(matchedCount.organic, total),
      aiOverview: ratio(matchedCount.aiOverview, total),
      aiMode: ratio(matchedCount.aiMode, total),
    },
  };
}

export interface RankCell {
  position: number | null;
  /** Positive = moved up (better) since this keyword's previous tracked day. */
  delta: number | null;
  enteredTop: boolean;
  droppedOut: boolean;
  aiOverviewShown: boolean;
  aiOverviewMatched: boolean;
  aiModeShown: boolean;
  aiModeMatched: boolean;
}

export interface RankRow {
  keywordId: string;
  keyword: string;
  landingUrl: string | null;
  best: { position: number; date: string } | null;
  latest: RankCell | null;
  cells: Record<string, RankCell>;
}

/** Keyword x date organic-position grid for one subject - the rank-tracker table. */
export function computeRankGrid(
  histories: KeywordHistory[],
  subjectIndex: number,
  hits: HitLookup
): { dates: string[]; rows: RankRow[] } {
  const dates = collectDates(histories).reverse();
  const rows = histories.map((h): RankRow => {
    const days = h.days.filter((d) => !d.error).sort((a, b) => a.date.localeCompare(b.date));
    const cells: Record<string, RankCell> = {};
    let prev: RankCell | null = null;
    let best: RankRow["best"] = null;
    let landingUrl: string | null = null;

    for (const day of days) {
      const dh = hits(day, subjectIndex);
      const position = dh.organicPosition;
      const cell: RankCell = {
        position,
        delta: prev && prev.position != null && position != null ? prev.position - position : null,
        enteredTop: !!prev && prev.position == null && position != null,
        droppedOut: !!prev && prev.position != null && position == null,
        aiOverviewShown: day.aiOverview.present,
        aiOverviewMatched: dh.aiOverview.matched,
        aiModeShown: day.aiMode.present,
        aiModeMatched: dh.aiMode.matched,
      };
      cells[day.date] = cell;
      prev = cell;
      if (position != null) {
        if (!best || position < best.position || (position === best.position && day.date > best.date)) {
          best = { position, date: day.date };
        }
        landingUrl = day.organicResults.find((r) => r.position === position)?.link ?? landingUrl;
      }
    }

    return { keywordId: h.keywordId, keyword: h.keyword, landingUrl, best, latest: prev, cells };
  });
  return { dates, rows };
}

/** Which subjects own an organic result (their website) or are merely mentioned in it - for tagging rows in a SERP list. */
export function subjectsInResult(result: OrganicResultSnapshot, subjects: Subject[]): Array<{ subject: Subject; owns: boolean }> {
  const text = `${result.title} ${result.snippet}`;
  const found: Array<{ subject: Subject; owns: boolean }> = [];
  for (const s of subjects) {
    if (domainMatchesWebsite(result.domain, s.website)) {
      found.push({ subject: s, owns: true });
      continue;
    }
    const mentioned = [s.def.name, ...s.def.aliases].filter((n) => n.trim()).some((n) => {
      const escaped = n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(text);
    });
    if (mentioned) found.push({ subject: s, owns: false });
  }
  return found;
}

export interface DomainRow {
  domain: string;
  owner: Subject | null;
  organicAppearances: number;
  avgPosition: number | null;
  aiOverviewCitations: number;
  aiModeCitations: number;
  keywords: number;
  total: number;
  sampleLink: string | null;
}

/** Every domain seen in organic results or cited as an AI source, minus user-excluded ones. */
export function computeDomainRows(
  histories: KeywordHistory[],
  subjects: Subject[],
  excludedDomains: string[],
  filter: SurfaceFilter
): { rows: DomainRow[]; hiddenCount: number } {
  const surfaces = surfacesIn(filter);
  const excluded = excludedDomains.map((d) => d.toLowerCase().trim().replace(/^www\./, "")).filter(Boolean);
  const isExcluded = (domain: string) => excluded.some((ex) => domain === ex || domain.endsWith(`.${ex}`));
  const byDomain = new Map<
    string,
    { organic: number; positionSum: number; aio: number; aiMode: number; keywords: Set<string>; link: string | null }
  >();
  const hidden = new Set<string>();

  const entry = (domain: string, keyword: string, link: string) => {
    if (!domain) return null;
    if (isExcluded(domain)) {
      hidden.add(domain);
      return null;
    }
    let e = byDomain.get(domain);
    if (!e) {
      e = { organic: 0, positionSum: 0, aio: 0, aiMode: 0, keywords: new Set(), link };
      byDomain.set(domain, e);
    }
    e.keywords.add(keyword);
    return e;
  };

  for (const h of histories) {
    for (const day of h.days) {
      if (day.error) continue;
      if (surfaces.includes("organic")) {
        for (const r of day.organicResults) {
          const e = entry(r.domain, h.keyword, r.link);
          if (e) {
            e.organic++;
            e.positionSum += r.position;
          }
        }
      }
      if (surfaces.includes("aiOverview")) {
        for (const s of day.aiOverview.sources) {
          const e = entry(s.domain, h.keyword, s.link);
          if (e) e.aio++;
        }
      }
      if (surfaces.includes("aiMode")) {
        for (const s of day.aiMode.sources) {
          const e = entry(s.domain, h.keyword, s.link);
          if (e) e.aiMode++;
        }
      }
    }
  }

  const rows = Array.from(byDomain.entries()).map(([domain, e]): DomainRow => ({
    domain,
    owner: subjects.find((s) => domainMatchesWebsite(domain, s.website)) ?? null,
    organicAppearances: e.organic,
    avgPosition: e.organic > 0 ? e.positionSum / e.organic : null,
    aiOverviewCitations: e.aio,
    aiModeCitations: e.aiMode,
    keywords: e.keywords.size,
    total: e.organic + e.aio + e.aiMode,
    sampleLink: e.link,
  }));
  rows.sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain));
  return { rows, hiddenCount: hidden.size };
}

export type MentionStatus = "cited" | "mentioned" | "none" | "notShown";

export interface AiResponseItem {
  key: string;
  keywordId: string;
  keyword: string;
  date: string;
  surface: AiSurface;
  answer: AiTextSnapshot;
  /** Subjects whose name/alias appears in the answer or whose site is cited, with how they matched. */
  subjectHits: Array<{ subject: Subject; mentioned: boolean; cited: boolean }>;
  yours: MentionStatus;
}

function statusOf(hit: BrandHit, shown: boolean): MentionStatus {
  if (!shown) return "notShown";
  if (!hit.matched) return "none";
  return hit.matchedBy.includes("website") ? "cited" : "mentioned";
}

/** Every AI Overview / AI Mode answer captured on a given date (or each keyword's latest date). */
export function collectAiResponses(
  histories: KeywordHistory[],
  subjects: Subject[],
  hits: HitLookup,
  surfaces: AiSurface[],
  date: string | null
): AiResponseItem[] {
  const items: AiResponseItem[] = [];
  for (const h of histories) {
    const days = h.days.filter((d) => !d.error);
    const day = date ? days.find((d) => d.date === date) : days.sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!day) continue;
    for (const surface of surfaces) {
      const answer = day[surface];
      const subjectHits = subjects.map((subject, si) => {
        const hit = hits(day, si)[surface];
        return {
          subject,
          mentioned: hit.matchedBy.includes("name") || hit.matchedBy.includes("alias"),
          cited: hit.matchedBy.includes("website"),
        };
      });
      items.push({
        key: `${h.keywordId}-${day.date}-${surface}`,
        keywordId: h.keywordId,
        keyword: h.keyword,
        date: day.date,
        surface,
        answer,
        subjectHits,
        yours: statusOf(hits(day, 0)[surface], answer.present),
      });
    }
  }
  return items;
}
