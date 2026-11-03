import { ensureBudget, recordSpend } from "../brand/spend";
import { isMockMode } from "../openai";
import type { TrackingConfig } from "../tracking/types";
import { crawlSite, normalizeDomain, siteDigest } from "./crawl";
import { buildProfile, expectedProfileCost, PROFILE_MODEL } from "./profile";
import { checkSite } from "./readiness";
import { brandPass, demandPass, demandQueries, serpDigest, serpIsMock } from "./serp";
import { readKnowledgeBase, updateKnowledgeBase } from "./store";
import type { KnowledgeBase, ResearchStep } from "./types";

export class ResearchInputError extends Error {}

/**
 * One step of the knowledge-base research, run as its own request so each fits a serverless time limit:
 * site (crawl + AI-readiness checks), serp (Google brand searches), profile (ChatGPT), demand (Google demand searches).
 */
export async function runResearchStep(projectId: string, config: TrackingConfig, step: ResearchStep): Promise<KnowledgeBase> {
  const brand = config.brand.name.trim();
  const domain = normalizeDomain(config.brand.website || "");
  if (!brand || !domain) throw new ResearchInputError("Set the brand name and website in Settings first");
  const gl = config.settings.country || "us";
  const hl = config.settings.language || "en";
  const compDomains = config.competitors.map((c) => normalizeDomain(c.website)).filter(Boolean);

  if (step === "site") {
    const crawl = await crawlSite(domain, 10);
    const ready = checkSite(crawl);
    return updateKnowledgeBase(projectId, (kb) => {
      kb.site = { fetchedAt: new Date().toISOString(), ...crawl, ...ready };
    });
  }
  if (step === "serp") {
    const brandResults = await brandPass(brand, domain, gl, hl, compDomains);
    return updateKnowledgeBase(projectId, (kb) => {
      kb.serp = { fetchedAt: new Date().toISOString(), brand: brandResults, demand: kb.serp?.demand ?? [], mock: serpIsMock() };
    });
  }
  if (step === "profile") {
    const current = await readKnowledgeBase(projectId);
    if (!isMockMode()) await ensureBudget(expectedProfileCost());
    const { profile, costUsd, mock } = await buildProfile({
      brandName: brand,
      domain,
      market: `${gl.toUpperCase()} / ${hl}`,
      siteDigest: current.site ? siteDigest(current.site.pages) : "",
      serpDigest: current.serp ? serpDigest(current.serp.brand) : "",
      competitors: config.competitors.map((c) => c.name),
    });
    await recordSpend("openai", costUsd);
    return updateKnowledgeBase(projectId, (kb) => {
      // Answers the team already gave survive a re-run when the same question comes back.
      const answered = new Map((kb.profile?.factsToVerify ?? []).filter((f) => f.answer).map((f) => [f.question.toLowerCase(), f]));
      profile.factsToVerify = profile.factsToVerify.map((f) => answered.get(f.question.toLowerCase()) ?? f);
      kb.profile = { ...profile, generatedAt: new Date().toISOString(), model: mock ? "mock" : PROFILE_MODEL, mock };
      kb.costUsd += costUsd;
    });
  }
  // demand
  const current = await readKnowledgeBase(projectId);
  const category = current.profile?.category || config.keywords[0]?.keyword || brand;
  const queries = demandQueries(category, (current.profile?.offerings ?? []).map((o) => o.name), current.profile?.markets ?? []);
  const results = await demandPass(queries, gl, hl, domain, compDomains);
  return updateKnowledgeBase(projectId, (kb) => {
    kb.serp = { fetchedAt: new Date().toISOString(), brand: kb.serp?.brand ?? [], demand: results, mock: serpIsMock() };
  });
}
