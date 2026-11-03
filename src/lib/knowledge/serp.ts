import { hasServerApiKeys } from "../serpKeyPool";
import { serpRequest } from "../serpRequest";
import type { CommonQuery, SerpOrganic, SerpPass, SerpResultType } from "./types";

/**
 * Google research through SerpApi for the knowledge base.
 * Brand pass: "<brand>", "site:<domain>", "<brand> reviews" + autocomplete - who ranks for the brand, knowledge panel,
 * indexed pages. Demand pass: the category and each offering in the market - People also ask, related searches and
 * autocomplete, i.e. what buyers really search.
 */

const REVIEW = ["tripadvisor.", "trustpilot.", "g2.com", "capterra.", "yelp.", "booking.com", "agoda.", "expedia.", "foody.vn", "glassdoor.", "producthunt.", "getapp.", "clutch.co", "google.com/maps", "reviews."];
const SOCIAL = ["facebook.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com", "twitter.com", "x.com", "zalo.me", "pinterest.", "threads.net"];
const COMMUNITY = ["reddit.com", "quora.com", "voz.vn", "tinhte.vn", "medium.com", "wikipedia.org"];

export const hostOf = (link: string): string => {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
export const sameSite = (host: string, domainInput: string) => {
  const domain = domainInput.replace(/:\d+$/, "");
  return !!domain && (host === domain || host.endsWith(`.${domain}`));
};

export function classifyResult(link: string, ownDomain: string, competitorDomains: string[]): SerpResultType {
  const host = hostOf(link);
  const low = link.toLowerCase();
  if (sameSite(host, ownDomain)) return "own site";
  if (competitorDomains.some((d) => sameSite(host, d))) return "competitor";
  if (REVIEW.some((s) => low.includes(s))) return "review / directory";
  if (SOCIAL.some((s) => host.includes(s))) return "social";
  if (COMMUNITY.some((s) => host.includes(s))) return "community";
  return "other";
}

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");

async function google(query: string, kind: SerpPass["kind"], gl: string, hl: string, own: string, comps: string[]): Promise<SerpPass> {
  const pass: SerpPass = { query, kind, organic: [], questions: [], related: [], suggestions: [], knowledgeGraph: {}, totalResults: null };
  try {
    const d = await serpRequest({ engine: "google", q: query, gl, hl, num: "10" });
    pass.organic = arr(d.organic_results).slice(0, 10).map((o, i): SerpOrganic => ({
      position: typeof o.position === "number" ? o.position : i + 1,
      title: s(o.title),
      link: s(o.link),
      domain: hostOf(s(o.link)),
      type: classifyResult(s(o.link), own, comps),
    }));
    pass.questions = arr(d.related_questions).map((q) => s(q.question)).filter(Boolean);
    pass.related = arr(d.related_searches).map((q) => s(q.query)).filter(Boolean);
    const kg = (d.knowledge_graph ?? {}) as Json;
    pass.knowledgeGraph = Object.fromEntries(["title", "type", "description", "website", "rating", "reviews"].filter((k) => kg[k] != null).map((k) => [k, String(kg[k])]));
    const total = (d.search_information as Json | undefined)?.total_results;
    pass.totalResults = typeof total === "number" ? total : null;
  } catch (err) {
    pass.error = err instanceof Error ? err.message.slice(0, 300) : "SerpApi failed";
  }
  return pass;
}

async function autocomplete(query: string, gl: string, hl: string): Promise<SerpPass> {
  const pass: SerpPass = { query, kind: "autocomplete", organic: [], questions: [], related: [], suggestions: [], knowledgeGraph: {}, totalResults: null };
  try {
    const d = await serpRequest({ engine: "google_autocomplete", q: query, gl, hl });
    pass.suggestions = arr(d.suggestions).map((x) => s(x.value)).filter(Boolean);
  } catch (err) {
    pass.error = err instanceof Error ? err.message.slice(0, 300) : "SerpApi failed";
  }
  return pass;
}

export const serpIsMock = () => !hasServerApiKeys();

export async function brandPass(brand: string, domain: string, gl: string, hl: string, competitorDomains: string[]): Promise<SerpPass[]> {
  if (serpIsMock()) return mockBrandPass(brand, domain, competitorDomains);
  const q: Array<[string, SerpPass["kind"]]> = [[brand, "brand"], [`site:${domain}`, "site"], [`${brand} reviews`, "reviews"]];
  const out = await Promise.all(q.map(([query, kind]) => google(query, kind, gl, hl, domain, competitorDomains)));
  out.push(await autocomplete(brand, gl, hl));
  return out;
}

export function demandQueries(category: string, offerings: string[], markets: string[], max = 5): string[] {
  const place = markets[0] ?? "";
  return [...new Set([`best ${category}`, ...offerings.map((o) => `best ${o} ${place}`.trim())].filter((q) => q.trim()))].slice(0, max);
}

export async function demandPass(queries: string[], gl: string, hl: string, own: string, comps: string[]): Promise<SerpPass[]> {
  if (serpIsMock()) return mockDemandPass(queries);
  const out = await Promise.all(queries.map((q) => google(q, "demand", gl, hl, own, comps)));
  out.push(...(await Promise.all(queries.slice(0, 3).map((q) => autocomplete(q.replace(/^best /, ""), gl, hl)))));
  return out;
}

export function commonQueries(passes: SerpPass[], limit = 120): CommonQuery[] {
  const seen = new Set<string>();
  const out: CommonQuery[] = [];
  for (const p of passes) {
    const groups: Array<[CommonQuery["source"], string[]]> = [["People also ask", p.questions], ["Related searches", p.related], ["Autocomplete", p.suggestions]];
    for (const [source, items] of groups) {
      for (const q of items) {
        const key = q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ query: q, source, seed: p.query });
      }
    }
  }
  return out.slice(0, limit);
}

export function serpDigest(passes: SerpPass[]): string {
  const lines: string[] = [];
  for (const p of passes) {
    if (p.error || p.kind === "autocomplete") continue;
    lines.push(`## Google results for: ${p.query}`);
    if (p.kind === "site" && p.totalResults != null) lines.push(`Indexed pages (approx.): ${p.totalResults}`);
    if (Object.keys(p.knowledgeGraph).length) lines.push(`Knowledge panel: ${Object.entries(p.knowledgeGraph).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
    p.organic.slice(0, 8).forEach((o) => lines.push(`${o.position}. ${o.title} (${o.domain})`));
    if (p.questions.length) lines.push(`People also ask: ${p.questions.slice(0, 6).join(" | ")}`);
  }
  const cq = commonQueries(passes, 40);
  if (cq.length) lines.push("## Real buyer searches", ...cq.map((q) => `- ${q.query}`));
  return lines.join("\n").slice(0, 9000);
}

// --- mock (no SerpApi key): plausible, clearly generic results so the flow can be tried --------------------------
function mockBrandPass(brand: string, domain: string, comps: string[]): SerpPass[] {
  const mk = (query: string, kind: SerpPass["kind"], links: string[]): SerpPass => ({
    query, kind, questions: kind === "brand" ? [`Is ${brand} worth it?`, `What does ${brand} offer?`] : [], related: kind === "brand" ? [`${brand} price`, `${brand} reviews`] : [],
    suggestions: [], knowledgeGraph: {}, totalResults: kind === "site" ? 42 : null,
    organic: links.map((link, i) => ({ position: i + 1, title: `${hostOf(link)} (sample result)`, link, domain: hostOf(link), type: classifyResult(link, domain, comps) })),
  });
  return [
    mk(brand, "brand", [`https://${domain}/`, "https://www.tripadvisor.com/sample", "https://www.facebook.com/sample", ...comps.slice(0, 2).map((c) => `https://${c}/`)]),
    mk(`site:${domain}`, "site", [`https://${domain}/`, `https://${domain}/about/`]),
    mk(`${brand} reviews`, "reviews", ["https://www.tripadvisor.com/sample-reviews", "https://www.reddit.com/r/sample"]),
    { query: brand, kind: "autocomplete", organic: [], questions: [], related: [], suggestions: [`${brand} booking`, `${brand} location`], knowledgeGraph: {}, totalResults: null },
  ];
}

function mockDemandPass(queries: string[]): SerpPass[] {
  return queries.map((q) => ({
    query: q, kind: "demand" as const, organic: [], knowledgeGraph: {}, totalResults: null, suggestions: [],
    questions: [`What is the ${q.replace(/^best /, "")} near me?`, `How do I choose the ${q.replace(/^best /, "")}?`],
    related: [`${q} 2026`, `cheap ${q.replace(/^best /, "")}`],
  }));
}
