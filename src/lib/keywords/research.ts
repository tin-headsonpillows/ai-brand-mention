import { ensureBudget, recordSpend } from "../brand/spend";
import { normalizeDomain } from "../knowledge/crawl";
import { commonQueries } from "../knowledge/serp";
import { readKnowledgeBase } from "../knowledge/store";
import { isMockMode } from "../openai";
import type { TrackingConfig } from "../tracking/types";
import { finishResearch } from "./analyze";
import { kwSerpIsMock, keywordSerp } from "./serp";
import { readResearch, writeResearch } from "./store";
import { buildTaxonomy, expectedTaxonomyCost } from "./taxonomy";
import type { KeywordResearch, KeywordStep, ResearchKeyword } from "./types";
import { mockVolumes, parseVolumeCsv, seRankingVolumes, volumeIsMock, type VolumeRow } from "./volume";

export class KeywordInputError extends Error {}

/** SerpApi searches per request, so one step stays well inside a serverless time limit. */
export const SERP_BATCH = 8;
export const DEFAULT_MAX_SERP = 40;

const blank = (keyword: string, subcategory: string, offering: string): ResearchKeyword => ({
  keyword, subcategory, offering, volume: null, kd: null, cpc: null, sourceIntents: [], volumeStatus: "no volume data",
  serp: null, intent: "informational", aiOverview: false, brandRank: null, brandUrl: "", competitorRanks: {}, topDomains: [], clusterId: 0,
});

/** Keywords that get a live SERP check: the highest-volume ones first, up to `maxSerp`. */
export function serpQueue(r: KeywordResearch, maxSerp: number): ResearchKeyword[] {
  return [...r.keywords].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1)).slice(0, maxSerp).filter((k) => !k.serp);
}

export async function runKeywordStep(
  projectId: string,
  config: TrackingConfig,
  step: KeywordStep,
  opts: { csv?: string; csvName?: string; maxSerp?: number } = {}
): Promise<{ research: KeywordResearch; remaining?: number }> {
  const brand = config.brand.name.trim();
  if (!brand) throw new KeywordInputError("Set the brand name in Settings first");
  const gl = config.settings.country || "us";
  const hl = config.settings.language || "en";
  const r = await readResearch(projectId);
  const kb = await readKnowledgeBase(projectId);

  if (step === "taxonomy") {
    if (!isMockMode() && kb.profile) await ensureBudget(expectedTaxonomyCost());
    // Branded demand is tracked in Brand Mentions; keyword research is about the category.
    const brandTerms = [brand, ...config.brand.aliases].map((t) => t.toLowerCase()).filter((t) => t.length > 2);
    const unbranded = (q: string) => !brandTerms.some((t) => q.toLowerCase().includes(t));
    const real = commonQueries([...(kb.serp?.brand ?? []), ...(kb.serp?.demand ?? [])]).map((q) => q.query).filter(unbranded);
    const tax = await buildTaxonomy({ profile: kb.profile, brandName: brand, realQueries: real, tracked: config.keywords.map((k) => k.keyword).filter(unbranded), market: `${gl.toUpperCase()} / ${hl}` });
    await recordSpend("openai", tax.costUsd);
    const seen = new Set<string>();
    const keywords: ResearchKeyword[] = [];
    for (const sub of tax.subs) {
      for (const seed of sub.seeds) {
        const key = seed.toLowerCase().replace(/\s+/g, " ").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keywords.push(blank(seed.trim(), sub.name, sub.offering));
      }
    }
    return {
      research: await writeResearch({ ...r, category: tax.category, taxonomy: tax.subs, keywords: keywords.slice(0, 300), clusters: [], volumeSource: "",
        mock: { taxonomy: tax.mock, volume: false, serp: false }, costUsd: r.costUsd + tax.costUsd }),
    };
  }
  if (!r.keywords.length) throw new KeywordInputError("Build the taxonomy first");

  if (step === "volume") {
    let rows: Map<string, VolumeRow>;
    let source: string;
    let mock = false;
    if (opts.csv) {
      rows = parseVolumeCsv(opts.csv);
      if (!rows.size) throw new KeywordInputError("No keyword and volume columns found in that file");
      source = `File: ${opts.csvName || "upload"}`;
    } else if (!volumeIsMock()) {
      rows = await seRankingVolumes(r.keywords.map((k) => k.keyword), gl);
      source = `SE Ranking (${gl.toUpperCase()} database)`;
    } else {
      rows = mockVolumes(r.keywords.map((k) => k.keyword));
      source = "Sample volumes (no SE Ranking key)";
      mock = true;
    }
    for (const k of r.keywords) {
      const v = rows.get(k.keyword.toLowerCase());
      if (!v) continue;
      k.volume = v.volume;
      k.kd = v.kd;
      k.cpc = v.cpc;
      k.sourceIntents = v.intents;
      k.volumeStatus = (v.volume ?? 0) > 0 ? "validated" : v.volume === 0 ? "zero volume" : "no volume data";
    }
    return { research: await writeResearch({ ...r, volumeSource: source, mock: { ...r.mock, volume: mock }, clusters: [] }) };
  }

  if (step === "serp") {
    const queue = serpQueue(r, Math.max(1, Math.min(200, opts.maxSerp ?? DEFAULT_MAX_SERP)));
    const batch = queue.slice(0, SERP_BATCH);
    const results = await Promise.all(batch.map((k) => keywordSerp(k.keyword, gl, hl)));
    batch.forEach((k, i) => (k.serp = results[i]));
    const research = await writeResearch({ ...r, mock: { ...r.mock, serp: kwSerpIsMock() }, clusters: [] });
    return { research, remaining: queue.length - batch.length };
  }

  // finish: intent, clustering, URL mapping, priority
  const domain = normalizeDomain(config.brand.website || "");
  const competitors = [
    ...config.competitors.map((c) => ({ name: c.name, domain: normalizeDomain(c.website) })),
    ...(kb.profile?.competitors ?? []).map((c) => ({ name: c.name, domain: c.domain })),
  ].filter((c, i, all) => c.domain && all.findIndex((x) => x.name === c.name) === i);
  const clusters = finishResearch(r.keywords, {
    ownDomain: domain,
    brandNames: [brand, ...config.brand.aliases],
    competitors,
    markets: kb.profile?.markets ?? [],
    pages: (kb.site?.pages ?? []).map((p) => ({ url: p.url, title: p.title })),
    baseUrl: kb.site?.baseUrl || `https://${domain}/`,
  });
  return { research: await writeResearch({ ...r, clusters }) };
}
