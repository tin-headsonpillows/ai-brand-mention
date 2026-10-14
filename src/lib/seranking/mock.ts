import { hostOf } from "./client";
import type { SeAiEngine, SeAiPrompt, SeKeyword, SeSeries, SeSite, SeSnapshot } from "./types";

/** Generated SE Ranking data (no API key configured), deterministic per project so reloads look the same. */

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

const KEYWORDS = [
  ["luxury halong bay cruise", 1900],
  ["halong bay cruise", 6600],
  ["best halong bay cruise", 880],
  ["halong bay overnight cruise", 480],
  ["lan ha bay cruise", 320],
  ["halong bay 2 day cruise", 260],
  ["halong bay cruise price", 210],
  ["private halong bay cruise", 170],
  ["halong bay honeymoon cruise", 140],
  ["halong bay family cruise", 110],
  ["bai tu long bay cruise", 480],
  ["halong bay cruise deals", 90],
  ["halong bay wellness cruise", 50],
  ["halong bay wedding cruise", 40],
  ["halong bay tour from hanoi", 1300],
  ["top rated halong bay cruises", 720],
  ["halong bay 3 day cruise", 170],
  ["halong bay cruise reviews", 210],
  ["boutique cruise vietnam", 90],
  ["halong bay kayaking cruise", 70],
] as const;

const PROMPTS = [
  "best luxury cruise in halong bay",
  "is a 2 night halong bay cruise worth it",
  "halong bay cruise for honeymoon",
  "which halong bay cruise is best for families",
  "quiet halong bay cruise away from crowds",
  "halong bay vs lan ha bay cruise",
  "best boutique cruise in vietnam",
  "halong bay cruise with good food",
  "private cruise halong bay for a group",
  "halong bay cruise reviews 2026",
] as const;

export function mockSnapshot(site: SeSite, now: Date): SeSnapshot {
  const r = rng(site.id);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const host = hostOf(site.url);
  const engines = [
    { id: 945_859, searchEngineId: 375, name: "Google Vietnam", region: null, lang: "en", keywordCount: KEYWORDS.length },
    { id: 945_860, searchEngineId: 200, name: "Google USA", region: null, lang: "en", keywordCount: KEYWORDS.length },
  ];

  const keywords: SeKeyword[] = engines.flatMap((engine, ei) =>
    KEYWORDS.map(([name, volume], i) => {
      const base = Math.max(1, Math.round(1 + r() * 35 + ei * 4 + (i % 5) * 2));
      const positions = Array.from({ length: 31 }, (_, d) => {
        const drift = Math.round((30 - d) * (r() < 0.5 ? 0.15 : -0.1) + (r() - 0.5) * 3);
        const pos = Math.max(1, base + drift);
        return { date: day(today - (30 - d) * DAY), pos: i % 11 === 7 && d > 27 ? 0 : pos > 100 ? 0 : pos };
      });
      const at = (back: number) => {
        const p = positions[positions.length - 1 - back]?.pos ?? 0;
        return p > 0 ? p : null;
      };
      const current = at(0);
      const ch = (prev: number | null) => (prev !== null && current !== null ? prev - current : null);
      const ranked = positions.filter((p) => p.pos > 0).map((p) => p.pos);
      const features = ["reviews", "images", "people_also_ask", "sge", "video", "local_pack"].filter(() => r() < 0.4);
      return {
        id: `${engine.id}-${i}`,
        engineId: engine.id,
        name,
        groupId: "1",
        volume,
        cpc: Math.round(r() * 80) / 100,
        competition: Math.round(r() * 100) / 100,
        landing: `https://${host}/${name.split(" ").slice(-2).join("-")}`,
        features,
        ownFeatures: features.filter(() => r() < 0.3),
        positions,
        current,
        change1: ch(at(1)),
        change7: ch(at(7)),
        change30: ch(at(30)),
        best: ranked.length ? Math.min(...ranked) : null,
      } satisfies SeKeyword;
    })
  );

  const series = (engineId: number | null, name: string, start: number, slope: number, noise: number, decimals = 1): SeSeries => ({
    engineId,
    name,
    points: Array.from({ length: 181 }, (_, d) => ({
      date: day(today - (180 - d) * DAY),
      value: Math.round(Math.max(0, start + slope * d + (r() - 0.5) * noise) * 10 ** decimals) / 10 ** decimals,
    })),
  });

  const aiEngines: SeAiEngine[] = [
    ["chatgpt", "ChatGPT", 38, 6],
    ["google_ai_overview", "Google AI Overview", 22, -3],
    ["perplexity", "Perplexity", 31, 4],
  ].map(([baseName, label, mention, diff], i) => ({
    id: 150_000 + i,
    baseName: baseName as string,
    label: label as string,
    country: "us",
    lang: "en",
    region: null,
    promptsCount: PROMPTS.length,
    lastUpdate: day(today),
    mentionPct: mention as number,
    mentionDiff: diff as number,
    linkPct: Math.round((mention as number) * 0.4),
    linkDiff: Math.round((diff as number) / 2),
    aioPct: baseName === "google_ai_overview" ? 70 : null,
    overlapPct: baseName === "google_ai_overview" ? 25 : null,
    sourcesPct: baseName === "google_ai_overview" ? null : 80,
    trend: Array.from({ length: 31 }, (_, d) => ({
      date: day(today - (30 - d) * DAY),
      mention: Math.max(0, Math.min(100, Math.round((mention as number) - (diff as number) + ((diff as number) * d) / 30 + (r() - 0.5) * 10))),
      link: Math.max(0, Math.min(100, Math.round((mention as number) * 0.4 + (r() - 0.5) * 8))),
    })),
  }));

  const prompts: SeAiPrompt[] = PROMPTS.map((text, i) => ({
    text,
    volume: i % 3 === 0 ? 0 : Math.round(r() * 500),
    intent: ["I"],
    engines: Object.fromEntries(
      aiEngines.map((e) => {
        const shown = !(e.baseName === "google_ai_overview" && i % 4 === 1);
        const mention = shown ? (r() < 0.4 ? 0 : 1 + Math.floor(r() * 6)) : null;
        return [
          String(e.id),
          {
            date: day(today),
            mentionPos: mention,
            mentionsCount: shown ? 3 + Math.floor(r() * 8) : null,
            urlPos: shown ? (r() < 0.7 ? 0 : 1 + Math.floor(r() * 8)) : null,
            urlsCount: shown ? 5 + Math.floor(r() * 15) : null,
            prevMentionPos: shown ? (r() < 0.5 ? mention : 1 + Math.floor(r() * 6)) : null,
          },
        ];
      })
    ),
  }));

  const competitors = ["indochina-junk.com", "aucocruises.com", "heritage-line.com", "paradisevietnam.com"].map((d, i) => ({
    id: 773_899 + i,
    name: d,
    url: `http://${d}`,
    domainTrust: 30 + Math.round(r() * 30),
  }));

  return {
    version: 1,
    siteId: site.id,
    siteTitle: site.title,
    siteUrl: site.url,
    guestLink: null,
    syncedAt: now.toISOString(),
    mock: true,
    errors: {},
    summary: {
      todayAvg: 14,
      yesterdayAvg: 17,
      up: 9,
      down: 4,
      top5: 12,
      top10: 18,
      top30: 31,
      visibility: 267,
      visibilityPercent: 12.4,
      domainTrust: 62,
      indexGoogle: 573,
    },
    engines,
    history: {
      avg_pos: [series(engines[0].id, engines[0].name, 22, -0.04, 3), series(engines[1].id, engines[1].name, 30, -0.05, 4)],
      visibility_percent: [series(engines[0].id, engines[0].name, 8, 0.025, 1.5), series(engines[1].id, engines[1].name, 5, 0.02, 1.2)],
      top10: [series(engines[0].id, engines[0].name, 9, 0.02, 2, 0), series(engines[1].id, engines[1].name, 6, 0.015, 2, 0)],
    },
    keywords,
    competitors,
    serpDomains: [
      { domain: "tripadvisor.com", visibility: 21, backlinks: 410_000_000, refDomains: 4_100_000, isOwn: false, isCompetitor: false },
      { domain: host, visibility: 12, backlinks: 5_400, refDomains: 610, isOwn: true, isCompetitor: false },
      { domain: "indochina-junk.com", visibility: 9, backlinks: 21_000, refDomains: 1_200, isOwn: false, isCompetitor: true },
      { domain: "aucocruises.com", visibility: 7, backlinks: 3_100, refDomains: 380, isOwn: false, isCompetitor: true },
      { domain: "booking.com", visibility: 6, backlinks: 900_000_000, refDomains: 2_900_000, isOwn: false, isCompetitor: false },
      { domain: "vietnam.travel", visibility: 4, backlinks: 120_000, refDomains: 9_800, isOwn: false, isCompetitor: false },
    ],
    audit: {
      id: 701_400_000 + (site.id % 1000),
      url: site.url,
      title: site.title,
      status: "finished",
      lastUpdate: day(today - 6 * DAY),
      auditTime: `${day(today - 6 * DAY)} 10:52:36`,
      score: 78,
      prevScore: 74,
      pages: 214,
      errors: 61,
      warnings: 133,
      notices: 402,
      passed: 96,
      domain: { dt: 62, backlinks: 5_400, refDomains: 610, indexGoogle: 573 },
      issues: [
        { section: "Meta Tags", code: "title_duplicate", name: "URLs with duplicate page titles", status: "error", pages: 27 },
        { section: "Content", code: "duplicate_content", name: "Duplicate content", status: "error", pages: 18 },
        { section: "Links", code: "no_inlinks", name: "No inbound links", status: "error", pages: 9 },
        { section: "Content", code: "images4xx", name: "4XX images (Not Found)", status: "error", pages: 4 },
        { section: "Links", code: "links3xx", name: "Internal links to 3XX redirect pages", status: "warning", pages: 41 },
        { section: "Content", code: "image_no_alt", name: "Alt text missing", status: "warning", pages: 33 },
        { section: "Content", code: "image_big", name: "Image too big", status: "warning", pages: 21 },
        { section: "Speed & Performance", code: "lighthouse_lcp", name: "Largest Contentful Paint (LCP) in a lab environment", status: "warning", pages: 12 },
        { section: "Meta Tags", code: "description_long", name: "Description too long", status: "notice", pages: 26 },
        { section: "Content", code: "h1_duplicate", name: "Duplicate H1", status: "notice", pages: 25 },
        { section: "CSS", code: "css_not_min", name: "CSS not minified", status: "notice", pages: 28 },
      ],
      sections: [
        { name: "Meta Tags", errors: 1, warnings: 0, notices: 1 },
        { name: "Content", errors: 2, warnings: 2, notices: 1 },
        { name: "Links", errors: 1, warnings: 1, notices: 0 },
        { name: "Speed & Performance", errors: 0, warnings: 1, notices: 0 },
        { name: "CSS", errors: 0, warnings: 0, notices: 1 },
      ],
      vitals: { mobile: 2, desktop: 1 },
    },
    backlinks: { total: 5_400, domains: 610, dofollow: 4_100, nofollow: 1_300, anchors: 820, ip: 540 },
    ai: {
      brand: site.title,
      engines: aiEngines,
      prompts,
      sources: {
        summary: { opportunities: 42, competitorOnly: 31, newOpportunities: 8, withoutBacklinks: 17 },
        brands: [
          { name: "Heritage Line", inAnswers: 96, inSources: 61 },
          { name: site.title, inAnswers: 74, inSources: 40 },
          { name: "Paradise Cruises", inAnswers: 58, inSources: 37 },
          { name: "Indochina Junk", inAnswers: 33, inSources: 21 },
        ],
        domains: [
          { domain: "tripadvisor.com", aiAnswers: 64, prompts: 9, coverage: 90, mentionRate: 40, dt: 93, isProject: false, isCompetitor: false, brandMentioned: true },
          { domain: host, aiAnswers: 31, prompts: 6, coverage: 60, mentionRate: 100, dt: 62, isProject: true, isCompetitor: false, brandMentioned: true },
          { domain: "reddit.com", aiAnswers: 27, prompts: 5, coverage: 50, mentionRate: 0, dt: 96, isProject: false, isCompetitor: false, brandMentioned: false },
          { domain: "travelandleisure.com", aiAnswers: 18, prompts: 4, coverage: 40, mentionRate: 20, dt: 88, isProject: false, isCompetitor: false, brandMentioned: false },
          { domain: "heritage-line.com", aiAnswers: 15, prompts: 4, coverage: 40, mentionRate: 0, dt: 45, isProject: false, isCompetitor: true, brandMentioned: false },
        ],
        recommendations: [
          { code: "secure_mentions", domain: null, count: null },
          { code: "reddit", domain: "reddit.com", count: 27 },
          { code: "youtube", domain: "youtube.com", count: 9 },
        ],
      },
    },
    visible: null,
  };
}
