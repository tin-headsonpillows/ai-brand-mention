import { getOpenAIClient, isMockMode, DEFAULT_MODEL } from "../openai";
import { tokenCost } from "../brand/pricing";
import type { BrandProfile, CompetitorType, Differentiator, KbCompetitor, Offering, Persona } from "./types";

/** The research model's brand profile: offerings with proof, personas, explicit vs self-claimed claims, competitors. */

export const PROFILE_MODEL = DEFAULT_MODEL;

const INSTRUCTIONS = [
  "You are a senior SEO and Generative Engine Optimisation (GEO) specialist onboarding a new client.",
  "From the website content and Google results provided, build the project's brand knowledge base: a factual profile the team uses to write the AI-visibility prompt set and to judge how AI assistants describe the brand.",
  "Rules: use the client's own wording for offerings, but describe the category the way buyers search for it.",
  "AI assistants repeat explicit, checkable facts and ignore self-praise. For every offering list the proof points the site states (prices, specs, numbers, certifications, named clients, locations). For every differentiator record the explicit evidence, or mark it self_claimed when the site only uses adjectives.",
  "Never invent awards, numbers, reviews or clients. Cite the page (sourceUrl) where you found each fact.",
  "Personas: the distinct buyers the site targets, each with the pains that start their search, what they compare options on, and 2-3 questions they would ask an AI assistant.",
  "Competitors: 5-10 brands an AI assistant would likely recommend instead, typed as direct, category_leader, marketplace (aggregators/directories) or alternative.",
  "factsToVerify: what is missing, ambiguous or unproven that the client must confirm. Do not guess.",
  'Return ONLY JSON: {"brandName": string, "aliases": string[], "category": string, "oneLiner": string, "businessModel": "B2B"|"B2C"|"B2B2C"|"marketplace"|"other", "pricePositioning": "budget"|"mid-market"|"premium"|"luxury"|"enterprise"|"unknown", "markets": string[], "languages": string[] (ISO-639-1), "offerings": [{"name","description","productNames": string[],"proofPoints": string[],"sourceUrl"}], "personas": [{"name","description","painPoints": string[],"decisionCriteria": string[],"typicalQuestions": string[]}], "differentiators": [{"claim","evidence","evidenceType": "explicit"|"self_claimed","sourceUrl"}], "competitors": [{"name","domain","aliases": string[],"type","why"}], "factsToVerify": [{"question","why"}], "researchNotes": string}.',
].join(" ");

type Json = Record<string, unknown>;
const str = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max = 20) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) : []);
const objs = (v: unknown, max = 20): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]).slice(0, max) : []);
const TYPES: CompetitorType[] = ["direct", "category_leader", "marketplace", "alternative"];

export function normalizeProfile(raw: Json, fallbackName: string): BrandProfile {
  return {
    brandName: str(raw.brandName, 120) || fallbackName,
    aliases: strs(raw.aliases),
    category: str(raw.category, 200),
    oneLiner: str(raw.oneLiner, 300),
    businessModel: str(raw.businessModel, 30) || "other",
    pricePositioning: str(raw.pricePositioning, 30) || "unknown",
    markets: strs(raw.markets),
    languages: strs(raw.languages, 6),
    offerings: objs(raw.offerings).map((o): Offering => ({ name: str(o.name, 120), description: str(o.description), productNames: strs(o.productNames), proofPoints: strs(o.proofPoints), sourceUrl: str(o.sourceUrl, 500) })).filter((o) => o.name),
    personas: objs(raw.personas, 6).map((p): Persona => ({ name: str(p.name, 120), description: str(p.description), painPoints: strs(p.painPoints), decisionCriteria: strs(p.decisionCriteria), typicalQuestions: strs(p.typicalQuestions, 5) })).filter((p) => p.name),
    differentiators: objs(raw.differentiators).map((d): Differentiator => ({ claim: str(d.claim), evidence: str(d.evidence), evidenceType: d.evidenceType === "explicit" && str(d.evidence) ? "explicit" : "self_claimed", sourceUrl: str(d.sourceUrl, 500) })).filter((d) => d.claim),
    competitors: objs(raw.competitors, 12).map((c): KbCompetitor => ({ name: str(c.name, 120), domain: str(c.domain, 200).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""), aliases: strs(c.aliases, 6), type: TYPES.includes(c.type as CompetitorType) ? (c.type as CompetitorType) : "direct", why: str(c.why) })).filter((c) => c.name),
    factsToVerify: objs(raw.factsToVerify, 12).map((f) => ({ question: str(f.question), why: str(f.why) })).filter((f) => f.question),
    researchNotes: str(raw.researchNotes, 1500),
  };
}

export async function buildProfile(input: { brandName: string; domain: string; market: string; siteDigest: string; serpDigest: string; competitors: string[] }): Promise<{ profile: BrandProfile; costUsd: number; mock: boolean }> {
  if (isMockMode()) return { profile: mockProfile(input.brandName, input.domain, input.competitors), costUsd: 0, mock: true };
  const completion = await getOpenAIClient().chat.completions.create({
    model: PROFILE_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INSTRUCTIONS },
      {
        role: "user",
        content: [
          `CLIENT: ${input.brandName} (${input.domain}). TARGET MARKET: ${input.market}.`,
          input.competitors.length ? `Competitors the team already tracks: ${input.competitors.join(", ")}` : "",
          "WEBSITE CONTENT (crawled):",
          input.siteDigest || "(the site could not be crawled)",
          input.serpDigest ? `GOOGLE RESULTS:\n${input.serpDigest}` : "",
        ].filter(Boolean).join("\n\n"),
      },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Json;
  const u = completion.usage;
  return {
    profile: normalizeProfile(raw, input.brandName),
    costUsd: u ? tokenCost(PROFILE_MODEL, { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 }) : 0,
    mock: false,
  };
}

/** Typical tokens for the profile call, for the spending-cap check before it runs. */
export function expectedProfileCost(): number {
  return tokenCost(PROFILE_MODEL, { input: 14_000, output: 3_000 });
}

function mockProfile(brand: string, domain: string, competitors: string[]): BrandProfile {
  return {
    brandName: brand,
    aliases: [],
    category: "(sample) category inferred from the website",
    oneLiner: `Sample profile for ${brand}: add OPENAI_API_KEY to have ChatGPT write the real one from the crawl and Google results.`,
    businessModel: "other",
    pricePositioning: "unknown",
    markets: [],
    languages: ["en"],
    offerings: [{ name: "Main offering (sample)", description: "Replace with the real offering once ChatGPT runs.", productNames: [], proofPoints: [], sourceUrl: `https://${domain}/` }],
    personas: [{ name: "Main buyer (sample)", description: "Who buys and why.", painPoints: ["What makes them search"], decisionCriteria: ["Price", "Location"], typicalQuestions: [`Is ${brand} worth it?`] }],
    differentiators: [{ claim: "Sample differentiator", evidence: "", evidenceType: "self_claimed", sourceUrl: "" }],
    competitors: competitors.map((name) => ({ name, domain: "", aliases: [], type: "direct" as const, why: "Tracked in this project" })),
    factsToVerify: [{ question: "Sample question for the client", why: "Shows how open questions appear" }],
    researchNotes: "Mock mode: no OpenAI key is configured.",
  };
}
