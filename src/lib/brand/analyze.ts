import { DEFAULT_MODEL, getOpenAIClient, isMockMode } from "../openai";
import { countMentionsAny } from "../mentions";
import type { TrackedBrand, TrackedCompetitor } from "../tracking/types";
import { tokenCost } from "./pricing";
import type { BrandInAnswer, BrandResponse, Claim, PerceptionSegment, PerceptionSummary, ResponseAnalysis, Sentiment } from "./types";

/** The analysis model (the app's OPENAI_MODEL, gpt-4o-mini by default): cheap, JSON mode. */
export const ANALYSIS_MODEL = DEFAULT_MODEL;

const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sentimentOf = (v: unknown): Sentiment => (SENTIMENTS.includes(v as Sentiment) ? (v as Sentiment) : "neutral");
const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function brandTerms(brand: TrackedBrand): string[] {
  return [brand.name, ...brand.aliases].map((t) => t.trim()).filter((t) => t.length > 1);
}

/** Usage-priced cost of one chat completion. */
function completionCost(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  return usage ? tokenCost(ANALYSIS_MODEL, { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 }) : 0;
}

/**
 * Reads one AI answer and returns: is the brand mentioned (and where, and how favourably), every brand in it with
 * the attributes it's praised or criticised for, and the specific claims made about the tracked brand.
 */
export async function analyzeResponse(
  response: Pick<BrandResponse, "text" | "sources">,
  prompt: string,
  brand: TrackedBrand,
  competitors: TrackedCompetitor[],
  attributes: string[]
): Promise<{ analysis: ResponseAnalysis; costUsd: number }> {
  if (isMockMode()) return { analysis: mockAnalysis(response.text, brand, competitors, attributes), costUsd: 0 };
  const client = getOpenAIClient();
  const sources = response.sources.slice(0, 15).map((s, i) => `[${i}] ${s.domain} - ${s.title}`).join("\n");
  const completion = await client.chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You analyse how an AI assistant's answer talks about brands. Be literal: only report what the answer actually says.",
          `Tracked brand: "${brand.name}"${brand.aliases.length ? ` (also: ${brand.aliases.join(", ")})` : ""}${brand.website ? `, website ${brand.website}` : ""}.`,
          competitors.length ? `Known competitors: ${competitors.map((c) => c.name).join(", ")}.` : "",
          `Attribute names already in use (reuse one when it fits, otherwise create a short Title Case name of 1-3 words): ${attributes.length ? attributes.join(", ") : "(none yet)"}.`,
          "Return ONLY JSON:",
          '{"brandMentioned": boolean, "brandPosition": number|null, "brandSentiment": number|null,',
          ' "brands": [{"name": string, "position": number, "sentiment": number, "isTarget": boolean, "attributes": [{"attribute": string, "sentiment": "positive"|"neutral"|"negative"}]}],',
          ' "claims": [{"claim": string, "detail": string, "sentiment": "positive"|"neutral"|"negative", "attribute": string, "kind": "fact"|"opinion", "sourceIndex": number|null}]}',
          "Rules: brands = every company/brand/product named as an option (max 10), position = order of first mention (1 = first);",
          "sentiment is 0-100 (50 neutral) for how favourably the answer presents that brand; brandSentiment is the tracked brand's (null if not mentioned);",
          "claims are only about the tracked brand (max 8): claim is a short label (max 8 words, lower case), detail one sentence;",
          "kind 'fact' for checkable statements (numbers, capacity, prices, awards, locations, what it offers), 'opinion' for judgements;",
          "sourceIndex is the index of the listed source the answer relies on for that claim, if any.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      { role: "user", content: `Question asked: ${prompt}\n\nAnswer:\n${response.text.slice(0, 12000)}\n\nSources:\n${sources || "(none)"}` },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  const brands: BrandInAnswer[] = (Array.isArray(raw.brands) ? raw.brands : [])
    .slice(0, 10)
    .map((b, i): BrandInAnswer => {
      const o = (b ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name, 80),
        position: num(o.position) ?? i + 1,
        sentiment: clamp100(num(o.sentiment) ?? 50),
        isTarget: o.isTarget === true,
        attributes: (Array.isArray(o.attributes) ? o.attributes : [])
          .slice(0, 8)
          .map((a) => ({ attribute: str((a as Record<string, unknown>)?.attribute, 40), sentiment: sentimentOf((a as Record<string, unknown>)?.sentiment) }))
          .filter((a) => a.attribute),
      };
    })
    .filter((b, i, all) => b.name && all.findIndex((x) => x.name.toLowerCase() === b.name.toLowerCase()) === i);
  const claims: Claim[] = (Array.isArray(raw.claims) ? raw.claims : [])
    .slice(0, 8)
    .map((c): Claim => {
      const o = (c ?? {}) as Record<string, unknown>;
      const idx = num(o.sourceIndex);
      return {
        claim: str(o.claim, 120),
        detail: str(o.detail, 400),
        sentiment: sentimentOf(o.sentiment),
        attribute: str(o.attribute, 40) || "General",
        kind: o.kind === "fact" ? "fact" : "opinion",
        sourceIndex: idx !== null && idx >= 0 && idx < response.sources.length ? idx : null,
      };
    })
    .filter((c) => c.claim);
  // Trust a literal name match over the model when they disagree on whether the brand appears at all.
  const literal = countMentionsAny(response.text, brandTerms(brand)) > 0;
  const mentioned = raw.brandMentioned === true || literal;
  const target = brands.find((b) => b.isTarget);
  return {
    analysis: {
      brandMentioned: mentioned,
      brandPosition: mentioned ? num(raw.brandPosition) ?? target?.position ?? null : null,
      brandSentiment: mentioned ? clamp100(num(raw.brandSentiment) ?? target?.sentiment ?? 50) : null,
      brands,
      claims: mentioned ? claims : [],
    },
    costUsd: completionCost(completion.usage),
  };
}

/**
 * A two-paragraph read of how the AI answers portray the brand (strengths, then weaknesses), with the key
 * phrases tagged so the dashboard can underline them in green and red.
 */
export async function summarizePerception(
  brand: TrackedBrand,
  claims: Array<Claim & { platform: string }>,
  platformLabel: string
): Promise<{ summary: PerceptionSummary; costUsd: number }> {
  const generatedAt = new Date().toISOString();
  if (claims.length === 0) {
    return { summary: { paragraphs: [[{ text: `No answers on ${platformLabel} mentioned ${brand.name || "the brand"} yet.`, tone: null }]], generatedAt }, costUsd: 0 };
  }
  if (isMockMode()) return { summary: mockSummary(brand, claims), costUsd: 0 };
  const client = getOpenAIClient();
  const listing = claims
    .slice(0, 80)
    .map((c) => `- (${c.sentiment}, ${c.attribute}) ${c.claim}: ${c.detail}`)
    .join("\n");
  const completion = await client.chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          `Write how ${platformLabel} perceives the brand "${brand.name}", based only on the claims listed.`,
          "Two short paragraphs (2-3 sentences each): first what it is praised for, then the criticisms or doubts. Plain, specific, no hype.",
          "Return ONLY JSON: {\"paragraphs\": [[{\"text\": string, \"tone\": \"strength\"|\"weakness\"|null}]]} where each paragraph is a list of",
          "consecutive segments that together form the paragraph's sentences; mark the key phrases (3-8 words each) as strength or weakness, everything else null.",
        ].join(" "),
      },
      { role: "user", content: listing },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { paragraphs?: unknown };
  const paragraphs: PerceptionSegment[][] = (Array.isArray(raw.paragraphs) ? raw.paragraphs : [])
    .slice(0, 3)
    .map((p) =>
      (Array.isArray(p) ? p : [])
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const tone: PerceptionSegment["tone"] = o.tone === "strength" || o.tone === "weakness" ? o.tone : null;
          return { text: typeof o.text === "string" ? o.text : "", tone };
        })
        .filter((s) => s.text)
    )
    .filter((p) => p.length);
  return { summary: { paragraphs, generatedAt }, costUsd: completionCost(completion.usage) };
}

export interface SuggestedPrompt {
  text: string;
  topic: string;
}

/** Questions people would plausibly ask an AI where this brand should show up (branded and category questions). */
export async function suggestPrompts(
  brand: TrackedBrand,
  competitors: TrackedCompetitor[],
  keywords: string[],
  existing: string[],
  count: number,
  locale: string
): Promise<{ prompts: SuggestedPrompt[]; costUsd: number }> {
  if (isMockMode()) return { prompts: mockSuggestions(brand, keywords, count), costUsd: 0 };
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          `Suggest ${count} questions real customers would type into ChatGPT, Claude or Google AI Mode when researching the products/services of "${brand.name}"${brand.website ? ` (${brand.website})` : ""}.`,
          "Mix: about one third branded (naming the brand: reviews, comparisons with competitors, prices, what's included, is it worth it) and two thirds unbranded",
          "(category and need questions where the brand should appear: best options, recommendations, how to choose, for specific traveller types/occasions).",
          `Market/locale: ${locale}. Write in the language customers in that market would use.`,
          "Each question natural and specific (6-16 words). Group them with a short topic (1-3 words, e.g. Pricing, Comparisons, Family trips).",
          'Return ONLY JSON: {"prompts": [{"text": string, "topic": string}]}.',
        ].join(" "),
      },
      {
        role: "user",
        content: [
          competitors.length ? `Competitors: ${competitors.map((c) => c.name).join(", ")}` : "",
          keywords.length ? `Keywords they track on Google: ${keywords.slice(0, 40).join(", ")}` : "",
          existing.length ? `Already tracked (don't repeat): ${existing.slice(0, 80).join(" | ")}` : "",
        ]
          .filter(Boolean)
          .join("\n") || "(no other context)",
      },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { prompts?: unknown };
  const prompts = (Array.isArray(raw.prompts) ? raw.prompts : [])
    .map((p) => ({ text: str((p as Record<string, unknown>)?.text, 300), topic: str((p as Record<string, unknown>)?.topic, 40) || "General" }))
    .filter((p) => p.text.length > 5)
    .slice(0, count);
  return { prompts, costUsd: completionCost(completion.usage) };
}

// --- Placeholders (no OpenAI key) --------------------------------------------------------------------------

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const MOCK_ATTRS: Array<[string, Sentiment, string, string]> = [
  ["Service & Personalization", "positive", "attentive, personalised service", "Guests highlight hosts and butlers who remember names and preferences."],
  ["Itinerary & Routes", "positive", "quieter routes away from crowds", "Routes favour less crowded bays and smaller passenger counts."],
  ["Food & Dining", "positive", "high-quality seafood menus", "Multi-course menus with fresh local seafood get strong praise."],
  ["Cabins & Comfort", "positive", "spacious cabins with sea views", "Cabins are described as clean, large and well designed."],
  ["Reviews & Reputation", "positive", "strong guest reviews", "Independent review sites show high average ratings."],
  ["Fleet & Vessels", "negative", "older vessels showing their age", "Some older ships look dated compared with newer competitors."],
  ["Weather & Schedule", "negative", "itineraries that change with the weather", "Kayaking or cave visits can be cancelled in bad weather."],
  ["Value for Money", "negative", "premium prices", "Prices sit at the top of the market."],
];

function mockAnalysis(text: string, brand: TrackedBrand, competitors: TrackedCompetitor[], attributes: string[]): ResponseAnalysis {
  const terms = brandTerms(brand);
  const lower = text.toLowerCase();
  const mentioned = terms.some((t) => lower.includes(t.toLowerCase()));
  const names = [brand.name, ...competitors.map((c) => c.name), "Heritage Line", "Paradise Cruises", "Indochina Junk"].filter(Boolean);
  const found = names
    .map((name) => ({ name, at: lower.indexOf(name.toLowerCase()) }))
    .filter((b) => b.at >= 0)
    .sort((a, b) => a.at - b.at);
  const h = hash(text);
  const brands: BrandInAnswer[] = found.map((b, i) => {
    const attrs = MOCK_ATTRS.filter((a) => text.includes(a[2])).map((a) => ({ attribute: a[0], sentiment: a[1] }));
    return {
      name: b.name,
      position: i + 1,
      sentiment: clamp100(55 + ((h >> i) % 35) - (attrs.some((a) => a.sentiment === "negative") ? 12 : 0)),
      isTarget: b.name === brand.name,
      attributes: attrs.length ? attrs : [{ attribute: attributes[0] ?? "General", sentiment: "neutral" as Sentiment }],
    };
  });
  const target = brands.find((b) => b.isTarget);
  const claims: Claim[] = mentioned
    ? MOCK_ATTRS.filter((_, i) => (h >> i) % 3 === 0 || text.includes(MOCK_ATTRS[i][2]))
        .slice(0, 4)
        .map(([attribute, sentiment, claim, detail], i) => ({ claim, detail, sentiment, attribute, kind: i % 2 === 0 ? "fact" : "opinion", sourceIndex: i % 3 === 0 ? 0 : null }))
    : [];
  return {
    brandMentioned: mentioned,
    brandPosition: mentioned ? target?.position ?? 1 : null,
    brandSentiment: mentioned ? target?.sentiment ?? 60 : null,
    brands,
    claims,
  };
}

function mockSummary(brand: TrackedBrand, claims: Array<Claim & { platform: string }>): PerceptionSummary {
  const pos = [...new Set(claims.filter((c) => c.sentiment === "positive").map((c) => c.claim))].slice(0, 3);
  const neg = [...new Set(claims.filter((c) => c.sentiment === "negative").map((c) => c.claim))].slice(0, 3);
  const name = brand.name || "The brand";
  const paragraphs: PerceptionSegment[][] = [];
  if (pos.length) {
    paragraphs.push([
      { text: `${name} is presented as a strong choice, credited with `, tone: null },
      ...pos.flatMap((p, i) => [{ text: p, tone: "strength" as const }, { text: i < pos.length - 1 ? (i === pos.length - 2 ? " and " : ", ") : ".", tone: null }]),
    ]);
  }
  if (neg.length) {
    paragraphs.push([
      { text: "Answers also raise ", tone: null },
      ...neg.flatMap((p, i) => [{ text: p, tone: "weakness" as const }, { text: i < neg.length - 1 ? (i === neg.length - 2 ? " and " : ", ") : ".", tone: null }]),
    ]);
  }
  return { paragraphs, generatedAt: new Date().toISOString() };
}

function mockSuggestions(brand: TrackedBrand, keywords: string[], count: number): SuggestedPrompt[] {
  const name = brand.name || "this brand";
  const base: SuggestedPrompt[] = [
    { text: `Is ${name} worth the price?`, topic: "Pricing" },
    { text: `${name} reviews from recent guests`, topic: "Reviews" },
    { text: `${name} vs Heritage Line - which is better?`, topic: "Comparisons" },
    { text: "Best luxury Halong Bay cruise for couples", topic: "Recommendations" },
    { text: "Which Halong Bay cruise is best for families with young kids?", topic: "Family trips" },
    { text: "Quiet Halong Bay cruise routes away from the crowds", topic: "Itineraries" },
    { text: "2-night Lan Ha Bay cruise with good food recommendations", topic: "Recommendations" },
    { text: "Overnight cruise in Vietnam for a honeymoon", topic: "Occasions" },
    ...keywords.slice(0, 6).map((k) => ({ text: `What is the best option for ${k}?`, topic: "Keywords" })),
  ];
  return base.slice(0, count);
}
