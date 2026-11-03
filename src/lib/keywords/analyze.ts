import type { Intent, KeywordCluster, Priority, ResearchKeyword, UrlStatus } from "./types";

/** Pure steps 2 (intent), 4 (clustering), 5 (URL mapping) and 6 (prioritisation). */

const TRANSACTIONAL = /\b(buy|price|pricing|prices|cost|cheap|discount|deal|order|book|booking|quote|hire|subscribe|free trial)\b|(mua|giá|bảng giá|đặt|thuê|khuyến mãi)/iu;
const COMMERCIAL = /\b(best|top|vs|versus|review|reviews|compare|comparison|alternatives?|recommended)\b|(tốt nhất|so sánh|đánh giá|nên dùng|nào tốt)/iu;
const INFORMATIONAL = /\b(what|how|why|when|guide|tips|ideas|meaning|examples?|template)\b|(là gì|cách|hướng dẫn|tại sao)/iu;
const LOCAL = /\b(near me|nearby)\b|(gần đây|gần tôi)/iu;
const CODE: Record<string, Intent> = { T: "transactional", C: "commercial", L: "local", I: "informational", N: "navigational" };
const CODE_ORDER = ["T", "C", "L", "I", "N"];

export function classifyIntent(k: Pick<ResearchKeyword, "keyword" | "sourceIntents" | "serp">, brandNames: string[], markets: string[]): Intent {
  const kw = k.keyword.toLowerCase();
  if (brandNames.some((b) => b && kw.includes(b.toLowerCase()))) return "navigational";
  const feats = new Set(k.serp?.features ?? []);
  if (LOCAL.test(kw) || feats.has("Local pack") || markets.some((m) => m.length > 3 && kw.includes(m.toLowerCase()))) return "local";
  if (TRANSACTIONAL.test(kw) || feats.has("Shopping")) return "transactional";
  if (COMMERCIAL.test(kw)) return "commercial";
  const fromSource = CODE_ORDER.find((c) => k.sourceIntents.includes(c));
  if (fromSource && fromSource !== "N") return CODE[fromSource];
  if (INFORMATIONAL.test(kw)) return "informational";
  const titles = k.serp?.titles ?? [];
  if (titles.slice(0, 6).filter((t) => COMMERCIAL.test(t)).length >= 3) return "commercial";
  if (feats.has("Ads")) return "commercial";
  return "informational";
}

const normUrl = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`;
  } catch {
    return u;
  }
};

/** Keywords sharing at least `minShared` of their top-10 URLs are one cluster (SERP overlap). */
export function clusterKeywords(keywords: ResearchKeyword[], minShared = 3): number[][] {
  const parent = keywords.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const sets = keywords.map((k) => new Set((k.serp && !k.serp.error ? k.serp.urls : []).map(normUrl)));
  for (let i = 0; i < keywords.length; i++) {
    for (let j = i + 1; j < keywords.length; j++) {
      if (!sets[i].size || !sets[j].size) continue;
      let shared = 0;
      for (const u of sets[i]) if (sets[j].has(u)) shared++;
      if (shared >= minShared) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  keywords.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()];
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2));

export function mapUrl(members: ResearchKeyword[], main: string, pages: Array<{ url: string; title: string }>, baseUrl: string): { url: string; status: UrlStatus } {
  const ranked = members.filter((m) => m.brandRank);
  if (ranked.length) {
    const best = ranked.reduce((a, b) => ((a.brandRank ?? 99) <= (b.brandRank ?? 99) ? a : b));
    return { url: best.brandUrl, status: "ranking page" };
  }
  const tk = tokens(main);
  let best: { url: string } | null = null;
  let score = 0;
  for (const p of pages) {
    let path = "";
    try {
      path = new URL(p.url).pathname.replace(/[-/]/g, " ");
    } catch {
      path = "";
    }
    const pt = tokens(`${p.title} ${path}`);
    if (!tk.size || !pt.size) continue;
    let inter = 0;
    for (const t of tk) if (pt.has(t)) inter++;
    const s = inter / (tk.size + pt.size - inter);
    if (s > score) {
      best = p;
      score = s;
    }
  }
  if (best && score >= 0.3) return { url: best.url, status: "existing page" };
  const slug = main.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return { url: `${baseUrl.replace(/\/$/, "")}/${slug}/`, status: "new page" };
}

const INTENT_VALUE: Record<Intent, number> = { transactional: 1, commercial: 0.9, local: 0.9, informational: 0.5, navigational: 0.3 };

export function prioritise(clusters: KeywordCluster[]): void {
  const maxVol = Math.max(0, ...clusters.map((c) => c.totalVolume)) || 1;
  for (const c of clusters) {
    const vol = Math.log10(1 + c.totalVolume) / Math.log10(1 + maxVol);
    const gap = !c.bestBrandRank ? 1 : c.bestBrandRank > 3 ? 0.7 : 0.3;
    c.score = Math.round((0.5 * vol + 0.3 * INTENT_VALUE[c.intent] + 0.2 * gap) * (c.aiOverviewShare >= 0.5 ? 1.15 : 1) * 1000) / 1000;
  }
  const ranked = [...clusters].sort((a, b) => b.score - a.score);
  ranked.forEach((c, i) => {
    const p: Priority = i < Math.max(1, Math.round(ranked.length * 0.3)) ? "P1" : i < Math.round(ranked.length * 0.7) ? "P2" : "P3";
    c.priority = p;
  });
}

/** Steps 2 and 4-6 on keywords whose volume and SERP are already filled in. */
export function finishResearch(
  keywords: ResearchKeyword[],
  ctx: { ownDomain: string; brandNames: string[]; competitors: Array<{ name: string; domain: string }>; markets: string[]; pages: Array<{ url: string; title: string }>; baseUrl: string }
): KeywordCluster[] {
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const same = (h: string, d: string) => {
    const dom = d.replace(/:\d+$/, "");
    return !!dom && (h === dom || h.endsWith(`.${dom}`));
  };
  for (const k of keywords) {
    const urls = k.serp && !k.serp.error ? k.serp.urls : [];
    k.aiOverview = !!k.serp?.features.includes("AI Overview");
    k.topDomains = [...new Set(urls.map(host))].slice(0, 3);
    k.brandRank = null;
    k.brandUrl = "";
    k.competitorRanks = {};
    urls.forEach((u, i) => {
      const h = host(u);
      if (!k.brandRank && same(h, ctx.ownDomain)) {
        k.brandRank = i + 1;
        k.brandUrl = u;
      }
      for (const c of ctx.competitors) if (same(h, c.domain) && !(c.name in k.competitorRanks)) k.competitorRanks[c.name] = i + 1;
    });
    k.intent = classifyIntent(k, ctx.brandNames, ctx.markets);
  }
  const groups = clusterKeywords(keywords).sort((a, b) => keywords.filter((_, i) => b.includes(i)).reduce((s, k) => s + (k.volume ?? 0), 0) - keywords.filter((_, i) => a.includes(i)).reduce((s, k) => s + (k.volume ?? 0), 0));
  const clusters: KeywordCluster[] = groups.map((idx, n) => {
    const members = idx.map((i) => keywords[i]);
    members.forEach((m) => (m.clusterId = n + 1));
    const main = [...members].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.keyword.length - b.keyword.length)[0].keyword;
    const count = (vals: string[]) => [...new Set(vals)].sort((a, b) => vals.filter((v) => v === b).length - vals.filter((v) => v === a).length || (INTENT_VALUE[b as Intent] ?? 0) - (INTENT_VALUE[a as Intent] ?? 0))[0];
    const checked = members.filter((m) => m.serp && !m.serp.error);
    const ranks = members.map((m) => m.brandRank).filter((r): r is number => !!r);
    const { url, status } = mapUrl(members, main, ctx.pages, ctx.baseUrl);
    return {
      id: n + 1, name: main, subcategory: count(members.map((m) => m.subcategory)), keywords: members.map((m) => m.keyword),
      totalVolume: members.reduce((s, m) => s + (m.volume ?? 0), 0), intent: count(members.map((m) => m.intent)) as Intent,
      aiOverviewShare: checked.length ? checked.filter((m) => m.aiOverview).length / checked.length : 0,
      bestBrandRank: ranks.length ? Math.min(...ranks) : null, targetUrl: url, urlStatus: status, score: 0, priority: "P3",
    };
  });
  prioritise(clusters);
  return clusters;
}
