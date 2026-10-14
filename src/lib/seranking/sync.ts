import { fetchLinkProfile } from "./backlinks";
import { asList, hostOf, isSeRankingMock, num, seGet, str } from "./client";
import { MAX_SERP_KEYWORDS, buildCompetition, buildRival, type VisibilityDay } from "./competition";
import { mockSnapshot } from "./mock";
import {
  LINK_PROFILE_MAX_AGE_MS,
  LLM_LABEL,
  type HistoryMetric,
  type SeAi,
  type SeAiEngine,
  type SeAiPrompt,
  type SeAiSources,
  type SeAudit,
  type SeAuditIssue,
  type SeBacklinks,
  type SeCompetition,
  type SeCompetitor,
  type SeEngine,
  type SeKeyword,
  type SeLinkProfile,
  type SeRival,
  type SeSection,
  type SeSerpResult,
  type SeSeries,
  type SeSite,
  type SeSnapshot,
  type SeSummary,
  type SeVisible,
} from "./types";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const HISTORY_DAYS = 180;
const KEYWORD_DAYS = 30;
const MAX_LLM_ENGINES = 10;
const MAX_RIVALS = 10;
/** SE Ranking keeps the daily list of top-10 domains for 14 days. */
const VISIBILITY_DAYS = 14;

// --- Rank tracking -------------------------------------------------------------------------------------------

async function fetchSummary(siteId: number): Promise<SeSummary> {
  const r = obj(await seGet("project-management/sites/summary", { site_id: siteId }));
  return {
    todayAvg: num(r.today_avg),
    yesterdayAvg: num(r.yesterday_avg),
    up: num(r.total_up) ?? 0,
    down: num(r.total_down) ?? 0,
    top5: num(r.top5) ?? 0,
    top10: num(r.top10) ?? 0,
    top30: num(r.top30) ?? 0,
    visibility: num(r.visibility),
    visibilityPercent: num(r.visibility_percent),
    domainTrust: num(r.domain_trust) ?? num(r.da),
    indexGoogle: num(r.index_google),
  };
}

async function fetchEngines(siteId: number): Promise<SeEngine[]> {
  return asList(await seGet("project-management/sites/search-engines", { site_id: siteId }))
    .map((r) => ({
      id: num(r.site_engine_id) ?? 0,
      searchEngineId: num(r.search_engine_id) ?? 0,
      name: "",
      region: str(r.region_name),
      lang: str(r.lang_code),
      keywordCount: num(r.keyword_count) ?? 0,
    }))
    .filter((e) => e.id > 0);
}

async function fetchHistory(siteId: number, metric: HistoryMetric, from: string, to: string): Promise<SeSeries[]> {
  const rows = asList(await seGet("project-management/sites/positions/history", { site_id: siteId, type: metric, date_from: from, date_to: to }));
  return rows.map((r) => ({
    engineId: str(r.type) === "avg" ? null : num(r.search_engine_id),
    name: str(r.name) ?? "Search engine",
    points: asList(r.data).map((p) => ({ date: str(p.date) ?? "", value: num(p.value) })).filter((p) => p.date),
  }));
}

/** Position at the latest check on or before a date (null when not ranking or no check that early). */
function positionAt(positions: Array<{ date: string; pos: number }>, date: string): number | null | undefined {
  let found: { date: string; pos: number } | undefined;
  for (const p of positions) if (p.date <= date) found = p;
  if (!found) return undefined;
  return found.pos > 0 ? found.pos : null;
}

function change(prev: number | null | undefined, current: number | null): number | null {
  if (prev === undefined || prev === null || current === null) return null;
  return prev - current;
}

async function fetchKeywords(siteId: number, from: string, to: string): Promise<SeKeyword[]> {
  const [stats, list] = await Promise.all([
    seGet("project-management/sites/positions", { site_id: siteId, date_from: from, date_to: to, with_landing_pages: 1, with_serp_features: 1 }),
    seGet("project-management/keywords", { site_id: siteId }).catch(() => []),
  ]);
  const meta = new Map(asList(list).map((k) => [String(k.id), k]));
  const out: SeKeyword[] = [];
  for (const engine of asList(stats)) {
    const engineId = num(engine.site_engine_id) ?? 0;
    for (const k of asList(engine.keywords)) {
      const id = String(k.id ?? "");
      if (!id) continue;
      const info = meta.get(id) ?? {};
      const positions = asList(k.positions)
        .map((p) => ({ date: str(p.date) ?? "", pos: num(p.pos) ?? 0 }))
        .filter((p) => p.date)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const latest = positions.at(-1);
      const current = latest && latest.pos > 0 ? latest.pos : null;
      const latestDate = latest?.date ?? to;
      const prev = positions.length > 1 ? (positions[positions.length - 2].pos > 0 ? positions[positions.length - 2].pos : null) : undefined;
      const ranked = positions.filter((p) => p.pos > 0).map((p) => p.pos);
      const features = obj(k.features);
      const landing = asList(k.landing_pages)
        .map((l) => ({ url: str(l.url), date: str(l.date) ?? "" }))
        .filter((l): l is { url: string; date: string } => Boolean(l.url))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .at(-1)?.url;
      out.push({
        id,
        engineId,
        name: str(k.name) ?? str(info.name) ?? `Keyword ${id}`,
        groupId: str(k.group_id) ?? str(info.group_id),
        volume: num(k.volume),
        cpc: num(k.cpc) ?? num(k.suggested_bid),
        competition: num(k.competition),
        landing: landing ?? str(info.link),
        features: Object.keys(features),
        ownFeatures: Object.keys(features).filter((f) => features[f] === true),
        positions,
        current,
        change1: change(prev, current),
        change7: change(positionAt(positions, isoDay(Date.parse(latestDate) - 7 * DAY_MS)), current),
        change30: change(positions.length ? (positions[0].pos > 0 ? positions[0].pos : null) : undefined, current),
        best: ranked.length ? Math.min(...ranked) : null,
      });
    }
  }
  return out;
}

async function fetchCompetitors(siteId: number): Promise<SeCompetitor[]> {
  return asList(await seGet("project-management/competitors", { site_id: siteId }))
    .map((c) => ({ id: num(c.id) ?? 0, name: str(c.name) ?? str(c.url) ?? "", url: str(c.url) ?? "", domainTrust: num(c.domain_trust) }))
    .filter((c) => c.name);
}

/** Every domain in the top 10 of the project's keywords on the main engine: 14 days of visibility, plus each keyword's top 10. */
async function fetchCompetition(siteId: number, engine: SeEngine, date: string, keywords: SeKeyword[], siteHost: string, competitors: SeCompetitor[]): Promise<SeCompetition> {
  const visibilityDay = async (day: string): Promise<VisibilityDay> => ({
    date: day,
    rows: asList(await seGet("project-management/competitors/metrics", { site_id: siteId, site_engine_id: engine.id, date: day })).map((d) => ({
      domain: str(d.domain) ?? "",
      visibility: num(d.visibility) ?? 0,
      backlinks: num(d.backlinks),
      refDomains: num(d.domains),
    })),
  });
  const earlier = Array.from({ length: VISIBILITY_DAYS - 1 }, (_, i) => isoDay(Date.parse(date) - (VISIBILITY_DAYS - 1 - i) * DAY_MS));
  const top = keywords
    .filter((k) => k.engineId === engine.id)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, MAX_SERP_KEYWORDS);
  let failed = 0;
  let lastError: unknown = null;
  const serps: Record<string, SeSerpResult[]> = {};
  const readSerp = async (k: SeKeyword) => {
    try {
      const rows = asList(await seGet("project-management/competitors/serp10", { site_id: siteId, site_engine_id: engine.id, keyword_id: k.id, date }));
      serps[k.id] = rows
        .map((r) => ({ pos: num(r.position) ?? 0, url: str(r.url) ?? "", domain: hostOf(str(r.url) ?? "") }))
        .filter((r) => r.pos > 0 && r.domain)
        .sort((a, b) => a.pos - b.pos);
    } catch (err) {
      failed++;
      lastError = err;
    }
  };
  const [days] = await Promise.all([
    // The latest day must load; an older day SE Ranking no longer has just leaves a gap in the trend.
    Promise.all([visibilityDay(date), ...earlier.map((d) => visibilityDay(d).catch(() => ({ date: d, rows: [] })))]),
    Promise.all(top.map(readSerp)),
  ]);
  if (top.length > 0 && failed === top.length) throw lastError;
  return buildCompetition({ engine, days, serps, keywords: top, siteHost, competitors });
}

/** Tracked competitors' positions for the project's keywords, on every engine, over 30 days. */
async function fetchRivals(competitors: SeCompetitor[], from: string, to: string, errors: SnapshotErrors): Promise<SeRival[]> {
  const rivals = await Promise.all(
    competitors.slice(0, MAX_RIVALS).map(async (c) => {
      try {
        const engines = asList(await seGet("project-management/competitors/positions", { competitor_id: c.id, date_from: from, date_to: to }));
        return buildRival(
          c,
          engines.map((e) => ({
            engineId: num(e.site_engine_id) ?? 0,
            keywords: asList(e.keywords)
              .map((k) => ({
                id: str(k.id) ?? "",
                positions: asList(k.positions)
                  .map((p) => ({ date: str(p.date) ?? "", pos: num(p.pos) ?? 0 }))
                  .filter((p) => p.date),
              }))
              .filter((k) => k.id),
          }))
        );
      } catch (err) {
        errors.rivals = `${c.name}: ${message(err)}`;
        return null;
      }
    })
  );
  return rivals.filter((r): r is SeRival => r !== null);
}

// --- Site audit, backlinks --------------------------------------------------------------------------------------

async function fetchAudit(siteId: number, siteHost: string): Promise<SeAudit | null> {
  // { items, total } per the docs; asList also accepts a bare array.
  const items = asList(await seGet("project-management/audits", { search: siteHost, limit: 50 }));
  const mine = items
    .filter((a) => num(a.site_id) === siteId || hostOf(str(a.url) ?? "") === siteHost)
    .sort((a, b) => ((str(a.last_update) ?? "") < (str(b.last_update) ?? "") ? 1 : -1));
  const latest = mine.find((a) => num(a.site_id) === siteId) ?? mine[0];
  if (!latest) return null;
  const id = num(latest.id) ?? 0;
  const stats = obj(latest.stats);
  const prev = obj(latest.prev_stats);
  const base: SeAudit = {
    id,
    url: str(latest.url) ?? "",
    title: str(latest.title) ?? siteHost,
    status: str(latest.status) ?? "unknown",
    lastUpdate: str(latest.last_update),
    auditTime: null,
    score: num(stats.score),
    prevScore: num(prev.score),
    pages: num(stats.crawled) ?? 0,
    errors: num(stats.errors) ?? 0,
    warnings: num(stats.warnings) ?? 0,
    notices: num(stats.notices) ?? 0,
    passed: 0,
    domain: { dt: null, backlinks: null, refDomains: null, indexGoogle: null },
    issues: [],
    sections: [],
    vitals: null,
  };
  if (base.status !== "finished") return base;
  const report = obj(await seGet("project-management/audits/report", { audit_id: id }));
  const props = obj(report.domain_props);
  const issues: SeAuditIssue[] = [];
  const sections: SeAudit["sections"] = [];
  for (const section of asList(report.sections)) {
    const name = str(section.name) ?? "Other";
    const counts = { name, errors: 0, warnings: 0, notices: 0 };
    for (const check of Object.values(obj(section.props))) {
      const c = obj(check);
      const status = str(c.status);
      const pages = num(c.value) ?? 0;
      if (pages <= 0 || (status !== "error" && status !== "warning" && status !== "notice")) continue;
      issues.push({ section: name, code: str(c.code) ?? "", name: str(c.name) ?? "", status, pages });
      if (status === "error") counts.errors++;
      else if (status === "warning") counts.warnings++;
      else counts.notices++;
    }
    sections.push(counts);
  }
  const rank = { error: 0, warning: 1, notice: 2 } as const;
  issues.sort((a, b) => rank[a.status] - rank[b.status] || b.pages - a.pages);
  const ux = obj(report.chromeux);
  return {
    ...base,
    auditTime: str(report.audit_time),
    score: num(report.score_percent) ?? base.score,
    pages: num(report.total_pages) ?? base.pages,
    errors: num(report.total_errors) ?? base.errors,
    warnings: num(report.total_warnings) ?? base.warnings,
    notices: num(report.total_notices) ?? base.notices,
    passed: num(report.total_passed) ?? 0,
    domain: { dt: num(props.dt), backlinks: num(props.backlinks), refDomains: num(props.domains), indexGoogle: num(props.index_google) },
    issues,
    sections: sections.filter((s) => s.errors + s.warnings + s.notices > 0),
    vitals: Object.keys(ux).length ? { mobile: num(obj(ux.mobile).result), desktop: num(obj(ux.desktop).result) } : null,
  };
}

async function fetchBacklinks(siteId: number): Promise<SeBacklinks> {
  const r = obj(await seGet("project-management/backlinks/stats", { site_id: siteId }));
  return {
    total: num(r.total) ?? 0,
    domains: num(r.domains) ?? 0,
    dofollow: num(r.dofollow) ?? 0,
    nofollow: num(r.nofollow) ?? 0,
    anchors: num(r.anchors) ?? 0,
    ip: num(r.ip) ?? 0,
  };
}

// --- AI Results Tracker -------------------------------------------------------------------------------------------

async function fetchAiEngine(siteId: number, e: Json, from: string, to: string): Promise<{ engine: SeAiEngine; prompts: Array<{ key: string; text: string; volume: number | null; intent: string[] | null; result: SeAiPrompt["engines"][string] }> }> {
  const id = num(e.id) ?? 0;
  const baseName = str(e.base_name) ?? "ai";
  const [statsRaw, groupsRaw] = await Promise.all([
    seGet("project-management/airt/llm/statistics", { site_id: siteId, llm_id: id, from, to }),
    seGet("project-management/airt/prompts/rankings", { site_id: siteId, llm_id: id, mode: "groups", date_from: from, date_to: to, limit: 100 }).catch(() => null),
  ]);
  const stats = obj(statsRaw);
  const presence = obj(stats.presence);
  const aio = obj(stats.aio_presence);
  const overlap = obj(stats.organic_overlap);
  const sources = obj(stats.sources_presence);
  const basic = obj(stats.stats);

  // Presence over time, weighted by each group's prompt count.
  const byDate = new Map<string, { mention: number; link: number; weight: number }>();
  for (const g of asList(obj(groupsRaw).items)) {
    const weight = Math.max(1, num(g.prompts_count) ?? 1);
    for (const p of asList(g.positions)) {
      const date = str(p.date);
      if (!date) continue;
      const row = byDate.get(date) ?? { mention: 0, link: 0, weight: 0 };
      row.mention += (num(p.mention_presence) ?? 0) * weight;
      row.link += (num(p.link_presence) ?? 0) * weight;
      row.weight += weight;
      byDate.set(date, row);
    }
  }
  const trend = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, r]) => ({ date, mention: r.weight ? Math.round((r.mention / r.weight) * 10) / 10 : null, link: r.weight ? Math.round((r.link / r.weight) * 10) / 10 : null }));

  // Latest result per prompt over the last week (one page of up to 1,000 prompts per request).
  const weekAgo = isoDay(Date.parse(to) - 7 * DAY_MS);
  const prompts: Array<{ key: string; text: string; volume: number | null; intent: string[] | null; result: SeAiPrompt["engines"][string] }> = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const page = obj(await seGet("project-management/airt/prompts/rankings", { site_id: siteId, llm_id: id, date_from: weekAgo, date_to: to, limit: 1000, offset }));
    const items = asList(page.items);
    for (const item of items) {
      const text = str(item.prompt);
      if (!text) continue;
      const checks = asList(item.positions)
        .map((p) => ({
          date: str(p.date) ?? "",
          mentionPos: num(p.mention_position),
          mentionsCount: num(p.mentions_count),
          urlPos: num(p.url_position),
          urlsCount: num(p.urls_count),
        }))
        .filter((p) => p.date)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const last = checks.at(-1);
      if (!last) continue;
      prompts.push({
        key: text.toLowerCase(),
        text,
        volume: num(item.search_volume),
        intent: Array.isArray(item.search_intent) ? (item.search_intent as unknown[]).filter((x): x is string => typeof x === "string") : null,
        result: { ...last, prevMentionPos: checks.length > 1 ? checks[checks.length - 2].mentionPos : null },
      });
    }
    if (items.length < 1000 || offset + items.length >= (num(page.total) ?? 0)) break;
  }

  return {
    engine: {
      id,
      baseName,
      label: LLM_LABEL[baseName] ?? baseName,
      country: str(e.country_code),
      lang: str(e.lang_code),
      region: str(e.region_name),
      promptsCount: num(basic.prompts_count) ?? 0,
      lastUpdate: str(basic.last_update),
      mentionPct: num(presence.mention_percent_in_top),
      mentionDiff: num(presence.mention_diff),
      linkPct: num(presence.link_percent_in_top),
      linkDiff: num(presence.link_diff),
      aioPct: num(aio.prompts_with_aio),
      overlapPct: num(overlap.overlap_percent),
      sourcesPct: num(sources.answers_with_sources),
      trend,
    },
    prompts,
  };
}

async function fetchAiSources(siteId: number, from: string, to: string): Promise<SeAiSources> {
  const [summaryRaw, domainsRaw, recsRaw] = await Promise.all([
    seGet("project-management/airt/sources/summary", { site_id: siteId, date_from: from, date_to: to }),
    seGet("project-management/airt/sources/domains", { site_id: siteId, date_from: from, date_to: to, limit: 25, sort: "ai_answers_total", sort_order: "desc" }),
    seGet("project-management/airt/sources/recommendations", { site_id: siteId, date_from: from, date_to: to }).catch(() => null),
  ]);
  const s = obj(obj(summaryRaw).summary);
  return {
    summary: {
      opportunities: num(s.mention_opportunities) ?? 0,
      competitorOnly: num(s.competitor_only_mentions) ?? 0,
      newOpportunities: num(s.new_opportunities) ?? 0,
      withoutBacklinks: num(s.mentions_without_backlinks) ?? 0,
    },
    brands: asList(obj(summaryRaw).competitors)
      .map((c) => ({ name: str(c.name) ?? "", inAnswers: num(c.count_in_ai_answers) ?? 0, inSources: num(c.count_in_sources) ?? 0 }))
      .filter((c) => c.name)
      .sort((a, b) => b.inAnswers - a.inAnswers)
      .slice(0, 12),
    domains: asList(obj(domainsRaw).items).map((d) => ({
      domain: str(d.domain) ?? "",
      aiAnswers: num(d.ai_answers_total) ?? 0,
      prompts: num(d.prompts_total) ?? num(d.prompts) ?? 0,
      coverage: num(d.coverage_percent),
      mentionRate: num(d.mention_rate_percent),
      dt: num(d.dt),
      isProject: num(d.is_project) === 1,
      isCompetitor: num(d.is_competitor) === 1,
      brandMentioned: (num(d.brand_mentions_total) ?? 0) > 0,
    })),
    recommendations: asList(obj(recsRaw).items).map((r) => {
      const data = obj(r.data);
      return { code: str(r.code) ?? "", domain: str(data.domain), count: num(data.count) };
    }),
  };
}

async function fetchAi(siteId: number, from: string, to: string, errors: SnapshotErrors): Promise<SeAi | null> {
  const engines = asList(await seGet("project-management/airt/llm", { site_id: siteId }));
  if (engines.length === 0) return null;
  const brand = await seGet("project-management/airt/brand", { site_id: siteId })
    .then((b) => str(obj(b).brand))
    .catch(() => null);
  const results = await Promise.all(
    engines.slice(0, MAX_LLM_ENGINES).map((e) =>
      fetchAiEngine(siteId, e, from, to).catch((err) => {
        errors.ai = message(err);
        return null;
      })
    )
  );
  const prompts = new Map<string, SeAiPrompt>();
  for (const r of results) {
    if (!r) continue;
    for (const p of r.prompts) {
      const entry = prompts.get(p.key) ?? { text: p.text, volume: p.volume, intent: p.intent, engines: {} };
      entry.engines[String(r.engine.id)] = p.result;
      if (entry.volume === null) entry.volume = p.volume;
      prompts.set(p.key, entry);
    }
  }
  let sources: SeAiSources | null = null;
  try {
    sources = await fetchAiSources(siteId, from, to);
  } catch (err) {
    errors.aiSources = message(err);
  }
  return {
    brand,
    engines: results.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => r.engine),
    prompts: [...prompts.values()].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.text.localeCompare(b.text)),
    sources,
  };
}

// --- SE Visible ----------------------------------------------------------------------------------------------------

async function fetchVisible(siteHost: string, from: string, to: string): Promise<SeVisible | null> {
  const projects = asList(await seGet("se-visible/projects"));
  const project = projects.find((p) => hostOf(str(p.domain) ?? "") === siteHost);
  if (!project) return null;
  const id = str(project.id) ?? "";
  const range = { "date_range[0][from]": from, "date_range[0][to]": to };
  const metricNames = ["visibility_score", "share_of_voice", "sentiment_score", "avg_position", "total_mentions"];
  const [brandsRaw, metricsRaw, promptsRaw] = await Promise.all([
    seGet(`se-visible/projects/${encodeURIComponent(id)}/brands`),
    seGet(`se-visible/projects/${encodeURIComponent(id)}/brands/metrics`, { "dimensions[]": ["brand_id"], "metrics[]": metricNames, ...range, limit: 20 }).catch(() => null),
    seGet(`se-visible/projects/${encodeURIComponent(id)}/prompts`, { group_mode: "prompt", ...range, limit: 200 }),
  ]);
  const value = (m: unknown) => {
    const values = obj(m).values;
    return Array.isArray(values) ? num(values[0]) : null;
  };
  const metrics = new Map(asList(obj(metricsRaw).data).map((row) => [num(row.brand_id), row]));
  return {
    projectId: id,
    domain: str(project.domain) ?? siteHost,
    checkedAt: str(project.checked_at),
    models: asList(project.models).map((m) => str(m.model_type) ?? "").filter(Boolean),
    brands: asList(brandsRaw).map((b) => {
      const m = metrics.get(num(b.id)) ?? {};
      return {
        name: str(b.title) ?? "",
        isPrimary: b.is_primary === true,
        visibility: value(m.visibility_score),
        shareOfVoice: value(m.share_of_voice),
        sentiment: value(m.sentiment_score),
        avgPosition: value(m.avg_position),
        mentions: value(m.total_mentions),
      };
    }),
    prompts: asList(obj(promptsRaw).items).map((p) => ({
      text: str(p.prompt) ?? "",
      visibility: value(p.visibility),
      shareOfVoice: value(p.sov),
      avgPosition: value(p.avg_position),
      sentiment: value(p.sentiments),
      mentions: value(p.mentions),
      topBrands: asList(p.tops).map((t) => str(t.brand_name) ?? "").filter(Boolean).slice(0, 3),
    })),
  };
}

// --- Sync ------------------------------------------------------------------------------------------------------------

type SnapshotErrors = SeSnapshot["errors"];

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 240);
}

/** Runs a part of the sync; a failure is recorded against its section and the rest carries on. */
async function part<T>(errors: SnapshotErrors, section: SeSection, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    errors[section] = message(err);
    return fallback;
  }
}

export interface SyncOptions {
  /** The project's last snapshot: its backlink profile is reused while it's under a week old. */
  previous?: SeSnapshot | null;
  /** Refresh the backlink profile even if it's recent (costs SE Ranking API credits). */
  refreshLinks?: boolean;
}

/** The backlink profile for a snapshot: the recent one from the last sync, or a fresh one (Data API credits). */
export async function linkProfileFor(site: SeSite, competitors: SeCompetitor[], now: Date, options: SyncOptions, errors: SnapshotErrors): Promise<SeLinkProfile | null> {
  const kept = options.previous && options.previous.siteId === site.id ? (options.previous.linkProfile ?? null) : null;
  if (kept && !options.refreshLinks && now.getTime() - Date.parse(kept.fetchedAt) < LINK_PROFILE_MAX_AGE_MS) return kept;
  if (isSeRankingMock()) return mockSnapshot(site, now, kept, options.refreshLinks).linkProfile;
  try {
    return await fetchLinkProfile(site.url, competitors, now);
  } catch (err) {
    errors.linkProfile = message(err);
    return kept;
  }
}

/** Pulls everything the dashboard shows for one SE Ranking project into a snapshot (about 150-200 API requests). */
export async function syncSite(site: SeSite, now = new Date(), options: SyncOptions = {}): Promise<SeSnapshot> {
  if (isSeRankingMock()) return mockSnapshot(site, now, options.previous?.siteId === site.id ? options.previous.linkProfile : null, options.refreshLinks);
  const to = isoDay(now.getTime());
  const from30 = isoDay(now.getTime() - KEYWORD_DAYS * DAY_MS);
  const fromHistory = isoDay(now.getTime() - HISTORY_DAYS * DAY_MS);
  const siteHost = hostOf(site.url);
  const errors: SnapshotErrors = {};

  const [summary, engines, avgPos, visibility, top10, keywords, competitors, audit, backlinks, ai, visible] = await Promise.all([
    part(errors, "summary", () => fetchSummary(site.id), null),
    part(errors, "engines", () => fetchEngines(site.id), [] as SeEngine[]),
    part(errors, "history", () => fetchHistory(site.id, "avg_pos", fromHistory, to), [] as SeSeries[]),
    part(errors, "history", () => fetchHistory(site.id, "visibility_percent", fromHistory, to), [] as SeSeries[]),
    part(errors, "history", () => fetchHistory(site.id, "top10", fromHistory, to), [] as SeSeries[]),
    part(errors, "keywords", () => fetchKeywords(site.id, from30, to), [] as SeKeyword[]),
    part(errors, "competitors", () => fetchCompetitors(site.id), [] as SeCompetitor[]),
    part(errors, "audit", () => fetchAudit(site.id, siteHost), null),
    part(errors, "backlinks", () => fetchBacklinks(site.id), null),
    part(errors, "ai", () => fetchAi(site.id, from30, to, errors), null),
    // SE Visible is a separate product; most accounts don't have it, so a refusal isn't an error worth showing.
    fetchVisible(siteHost, from30, to).catch(() => null),
  ]);

  // Engine names come from the history series (the engines endpoint only returns catalogue IDs).
  for (const e of engines) {
    const named = [...avgPos, ...visibility].find((s) => s.engineId === e.id);
    e.name = named?.name ?? `Search engine ${e.searchEngineId}`;
  }
  const main = engines[0];
  const lastCheck = keywords.filter((k) => k.engineId === main?.id).flatMap((k) => k.positions.map((p) => p.date)).sort().at(-1);
  const [competition, rivals, linkProfile] = await Promise.all([
    main && lastCheck ? part(errors, "competition", () => fetchCompetition(site.id, main, lastCheck, keywords, siteHost, competitors), null) : Promise.resolve(null),
    part(errors, "rivals", () => fetchRivals(competitors, from30, to, errors), [] as SeRival[]),
    linkProfileFor(site, competitors, now, options, errors),
  ]);

  return {
    version: 1,
    siteId: site.id,
    siteTitle: site.title,
    siteUrl: site.url,
    guestLink: site.guestLink ?? null,
    syncedAt: now.toISOString(),
    mock: false,
    errors,
    summary,
    engines,
    history: { avg_pos: avgPos, visibility_percent: visibility, top10 },
    keywords,
    competitors,
    competition,
    rivals,
    audit,
    backlinks,
    linkProfile,
    ai,
    visible,
  };
}
