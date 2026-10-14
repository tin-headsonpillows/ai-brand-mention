/** SE Ranking: a project's rank tracking, site audit, AI Results Tracker and SE Visible data, synced into one snapshot. */

/** An SE Ranking project ("site"). */
export interface SeSite {
  id: number;
  title: string;
  url: string;
  keywordCount: number;
  isActive: boolean;
  guestLink?: string;
}

/** Which SE Ranking project an app project shows. siteId null = matched by the brand's website. */
export interface SeLink {
  siteId: number | null;
}

export interface SeSummary {
  todayAvg: number | null;
  yesterdayAvg: number | null;
  up: number;
  down: number;
  top5: number;
  top10: number;
  top30: number;
  visibility: number | null;
  visibilityPercent: number | null;
  domainTrust: number | null;
  indexGoogle: number | null;
}

/** A search engine configured in the project (Google + country/region + language). */
export interface SeEngine {
  id: number;
  searchEngineId: number;
  name: string;
  region: string | null;
  lang: string | null;
  keywordCount: number;
}

export interface SeSeries {
  engineId: number | null;
  name: string;
  points: Array<{ date: string; value: number | null }>;
}

export type HistoryMetric = "avg_pos" | "visibility_percent" | "top10";

export interface SeKeyword {
  id: string;
  engineId: number;
  name: string;
  groupId: string | null;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  landing: string | null;
  /** SERP features on the results page; ownFeatures are the ones that link to the site. */
  features: string[];
  ownFeatures: string[];
  /** Daily positions, oldest first. 0 = not in the tracked depth. */
  positions: Array<{ date: string; pos: number }>;
  /** Latest position, null when not ranking. */
  current: number | null;
  /** Positions gained (positive) or lost (negative) since the previous check / 7 / 30 days ago; null when either side isn't ranking. */
  change1: number | null;
  change7: number | null;
  change30: number | null;
  best: number | null;
}

export interface SeAuditIssue {
  section: string;
  code: string;
  name: string;
  status: "error" | "warning" | "notice";
  pages: number;
}

export interface SeAudit {
  id: number;
  url: string;
  title: string;
  status: string;
  lastUpdate: string | null;
  auditTime: string | null;
  score: number | null;
  prevScore: number | null;
  pages: number;
  errors: number;
  warnings: number;
  notices: number;
  passed: number;
  domain: { dt: number | null; backlinks: number | null; refDomains: number | null; indexGoogle: number | null };
  issues: SeAuditIssue[];
  sections: Array<{ name: string; errors: number; warnings: number; notices: number }>;
  /** Core Web Vitals verdicts from Chrome UX data: 0 good, 1 needs improvement, 2 poor. */
  vitals: { mobile: number | null; desktop: number | null } | null;
}

export interface SeBacklinks {
  total: number;
  domains: number;
  dofollow: number;
  nofollow: number;
  anchors: number;
  ip: number;
}

export interface SeCompetitor {
  id: number;
  name: string;
  url: string;
  domainTrust: number | null;
}

/** A domain ranking in the TOP 10 for the project's keywords, with its share of visibility. */
export interface SeSerpDomain {
  domain: string;
  visibility: number;
  backlinks: number | null;
  refDomains: number | null;
  isOwn: boolean;
  isCompetitor: boolean;
}

export const LLM_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_ai_overview: "Google AI Overview",
  google_ai_mode: "Google AI Mode",
  perplexity: "Perplexity",
  gemini: "Gemini",
};

/** An AI engine tracked in SE Ranking's AI Results Tracker (engine + country + language). */
export interface SeAiEngine {
  id: number;
  baseName: string;
  label: string;
  country: string | null;
  lang: string | null;
  region: string | null;
  promptsCount: number;
  lastUpdate: string | null;
  /** % of prompts where the brand is mentioned / the site is linked, and the change over the last 30 days (points). */
  mentionPct: number | null;
  mentionDiff: number | null;
  linkPct: number | null;
  linkDiff: number | null;
  /** Google AI Overview only: % of prompts that show an AI Overview, and organic-AIO URL overlap. */
  aioPct: number | null;
  overlapPct: number | null;
  /** Other engines: % of answers that cite sources. */
  sourcesPct: number | null;
  /** Daily mention / link presence over the last 30 days (% of prompts). */
  trend: Array<{ date: string; mention: number | null; link: number | null }>;
}

export interface SeAiResult {
  date: string;
  /** null: no AI answer block that day; 0: not mentioned / not linked; 1+: position. */
  mentionPos: number | null;
  mentionsCount: number | null;
  urlPos: number | null;
  urlsCount: number | null;
  /** The previous check's mention position, to show movement. */
  prevMentionPos: number | null;
}

export interface SeAiPrompt {
  text: string;
  volume: number | null;
  intent: string[] | null;
  /** Latest result per AI engine (keyed by engine id). */
  engines: Record<string, SeAiResult>;
}

export interface SeAiSources {
  summary: { opportunities: number; competitorOnly: number; newOpportunities: number; withoutBacklinks: number };
  brands: Array<{ name: string; inAnswers: number; inSources: number }>;
  domains: Array<{
    domain: string;
    aiAnswers: number;
    prompts: number;
    coverage: number | null;
    mentionRate: number | null;
    dt: number | null;
    isProject: boolean;
    isCompetitor: boolean;
    brandMentioned: boolean;
  }>;
  recommendations: Array<{ code: string; domain: string | null; count: number | null }>;
}

export interface SeAi {
  brand: string | null;
  engines: SeAiEngine[];
  prompts: SeAiPrompt[];
  sources: SeAiSources | null;
}

/** SE Visible (SE Ranking's separate AI-visibility product), when the account tracks the same domain there. */
export interface SeVisible {
  projectId: string;
  domain: string;
  checkedAt: string | null;
  models: string[];
  brands: Array<{ name: string; isPrimary: boolean; visibility: number | null; shareOfVoice: number | null; sentiment: number | null; avgPosition: number | null; mentions: number | null }>;
  prompts: Array<{ text: string; visibility: number | null; shareOfVoice: number | null; avgPosition: number | null; sentiment: number | null; mentions: number | null; topBrands: string[] }>;
}

export type SeSection = "summary" | "engines" | "history" | "keywords" | "competitors" | "serp" | "audit" | "backlinks" | "ai" | "aiSources" | "visible";

export interface SeSnapshot {
  version: 1;
  siteId: number;
  siteTitle: string;
  siteUrl: string;
  guestLink: string | null;
  syncedAt: string;
  /** Generated data (no SE Ranking key on the server). */
  mock: boolean;
  /** Parts of the sync that failed, with the API's message; the rest of the snapshot is still valid. */
  errors: Partial<Record<SeSection, string>>;
  summary: SeSummary | null;
  engines: SeEngine[];
  history: Partial<Record<HistoryMetric, SeSeries[]>>;
  keywords: SeKeyword[];
  competitors: SeCompetitor[];
  serpDomains: SeSerpDomain[];
  audit: SeAudit | null;
  backlinks: SeBacklinks | null;
  ai: SeAi | null;
  visible: SeVisible | null;
}
