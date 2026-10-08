import { DEFAULT_MODEL, getOpenAIClient, isMockMode } from "../openai";
import { countMentionsAny } from "../mentions";
import type { TrackedBrand, TrackedCompetitor } from "../tracking/types";
import { tokenCost } from "./pricing";
import type { CustomerVoice } from "./customers";
import type { BrandInAnswer, BrandResponse, Claim, CustomerGapItem, GapStatus, GapTone, PerceptionSegment, PerceptionSummary, ResponseAnalysis, Sentiment } from "./types";

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

/** What the brand's review listings say about it, to ground suggestions in its real category, location and audience. */
export interface SuggestContext {
  listings: string[];
  praised: string[];
  criticised: string[];
  travellers: string[];
}

/** The decision-making intents suggestions are grouped by. */
export const SUGGEST_TOPICS = ["Comparisons", "Worth it?", "Reviews", "Best for", "Right fit", "Who it suits"] as const;

/**
 * Questions that don't help anyone choose: price lists, nearby activities, directions, opening hours. "Is it worth
 * the price" is a decision question and stays.
 */
const NOT_DECISION =
  /\b(price range|how much (does|is|are|do)|what (is|are) the (price|cost|rates?)|cheapest (price|rate)|prices? (list|per night)|things to do|activities (near|around|in)|what to do|attractions? (near|around)|nearby|near(by)? (restaurants|attractions)|how (to|do i) get (to|there)|directions|opening hours|check-?in time|phone number|address of)\b/i;

export function isDecisionPrompt(text: string): boolean {
  return !NOT_DECISION.test(text);
}

export async function suggestPrompts(
  brand: TrackedBrand,
  competitors: TrackedCompetitor[],
  keywords: string[],
  existing: string[],
  count: number,
  locale: string,
  context?: SuggestContext
): Promise<{ prompts: SuggestedPrompt[]; costUsd: number }> {
  if (isMockMode()) return { prompts: mockSuggestions(brand, competitors, keywords, count, context), costUsd: 0 };
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          `Suggest ${count + 6} questions people type into ChatGPT, Claude or Google AI Mode while DECIDING whether to choose "${brand.name}"${brand.website ? ` (${brand.website})` : ""} or one of its alternatives.`,
          "First work out from the context what kind of business it is (e.g. luxury hotel, resort, cruise, restaurant, tour) and where it is; use that category and location in the questions.",
          "Every question must be consultative or comparative and help someone make a choice. Use these intents, as the topic of each question:",
          '"Comparisons" - the brand against a named competitor or two ("X vs Y: which is better for a honeymoon?");',
          '"Worth it?" - value and quality judgements ("Is X worth the price for a family of four?", "pros and cons of X");',
          '"Reviews" - what guests say ("X reviews: what do guests say about the service?");',
          '"Best for" - shortlists by purpose and place ("best [category] for [purpose] in [location]", e.g. best luxury hotels for a honeymoon in Da Nang);',
          '"Right fit" - which option suits a specific need ("which [category] in [location] is best for travellers with young kids / a wheelchair / remote work?");',
          '"Who it suits" - who the brand is best suited for ("Who is X best suited for?", "is X good for solo travellers?").',
          "About half should name the brand (Comparisons, Worth it?, Reviews, Who it suits) and half should be unbranded category questions where the brand should appear (Best for, Right fit).",
          "Use real purposes and needs from the context (traveller types, what customers praise or criticise). Use the competitors' names in comparisons.",
          "Do NOT write generic questions, price-range or 'how much does it cost' questions, lists of nearby activities or things to do, directions, opening hours or booking how-tos.",
          `Market/locale: ${locale}. Write in the language customers in that market would use. Each question natural and specific (6-18 words).`,
          `Return ONLY JSON: {"prompts": [{"text": string, "topic": one of ${SUGGEST_TOPICS.map((t) => `"${t}"`).join(", ")}}]}.`,
        ].join(" "),
      },
      {
        role: "user",
        content:
          [
            competitors.length ? `Competitors: ${competitors.map((c) => c.name).join(", ")}` : "",
            keywords.length ? `Keywords they track on Google: ${keywords.slice(0, 40).join(", ")}` : "",
            context?.listings.length ? `The brand's review listings: ${context.listings.join(" | ")}` : "",
            context?.travellers.length ? `Who reviews it most (trip types): ${context.travellers.join(", ")}` : "",
            context?.praised.length ? `What customers praise: ${context.praised.join(", ")}` : "",
            context?.criticised.length ? `What customers criticise: ${context.criticised.join(", ")}` : "",
            existing.length ? `Already tracked (don't repeat): ${existing.slice(0, 80).join(" | ")}` : "",
          ]
            .filter(Boolean)
            .join("\n") || "(no other context)",
      },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { prompts?: unknown };
  const taken = new Set(existing.map((e) => e.trim().toLowerCase()));
  const prompts = (Array.isArray(raw.prompts) ? raw.prompts : [])
    .map((p) => {
      const topic = str((p as Record<string, unknown>)?.topic, 40);
      return { text: str((p as Record<string, unknown>)?.text, 300), topic: (SUGGEST_TOPICS as readonly string[]).includes(topic) ? topic : topic || "Comparisons" };
    })
    .filter((p) => p.text.length > 5 && isDecisionPrompt(p.text) && !taken.has(p.text.toLowerCase()))
    .slice(0, count);
  return { prompts, costUsd: completionCost(completion.usage) };
}

// --- AI answers vs customer reviews ------------------------------------------------------------------------

/** What AI answers say about the brand, grouped by attribute, as input for the comparison. */
export interface AiClaimGroup {
  attribute: string;
  positive: number;
  negative: number;
  neutral: number;
  examples: string[];
}

const GAP_STATUSES: GapStatus[] = ["aligned", "missing", "contradicts", "ai-only"];
const GAP_TONES: GapTone[] = ["positive", "negative", "mixed", "none"];

/** Compares what customers say in reviews with what AI answers say, topic by topic. */
export async function compareWithCustomers(
  brand: TrackedBrand,
  ai: AiClaimGroup[],
  voice: CustomerVoice
): Promise<{ summary: string; items: CustomerGapItem[]; costUsd: number }> {
  if (isMockMode()) return { ...mockGap(ai, voice), costUsd: 0 };
  const client = getOpenAIClient();
  const customerLines = [
    `Reviews analysed: ${voice.totals.analysed} (average rating ${voice.totals.avgRating ?? "?"}/5)`,
    ...voice.bySource.map((s) => `${s.label}: ${s.reviews} reviews, avg ${s.avgRating ?? "?"}/5, ${s.positiveShare ?? "?"}% positive${s.ranking ? `, ${s.ranking}` : ""}`),
    "Praised:",
    ...voice.praise.map((a) => `+ ${a.aspect} (${a.count} reviews, ${a.share}%): ${a.quotes.map((q) => `"${q}"`).join(" ")}`),
    "Criticised:",
    ...voice.criticism.map((a) => `- ${a.aspect} (${a.count} reviews, ${a.share}%): ${a.quotes.map((q) => `"${q}"`).join(" ")}`),
    voice.tripadvisor?.summary ? `Tripadvisor's own review summary: ${voice.tripadvisor.summary}` : "",
    voice.tripTypes.length ? `Trip types: ${voice.tripTypes.map((t) => `${t.type} ${t.count} (avg ${t.avgRating ?? "?"})`).join(", ")}` : "",
  ].filter(Boolean);
  const aiLines = ai.length
    ? ai.map((g) => `${g.attribute}: ${g.positive} positive, ${g.negative} negative, ${g.neutral} neutral claims. e.g. ${g.examples.map((e) => `"${e}"`).join(" ")}`)
    : ["(AI answers made no claims about the brand)"];
  const completion = await client.chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          `You compare what AI answer engines (ChatGPT, Claude, Google AI Mode and AI Overviews) say about "${brand.name}" with what its customers say in reviews (Google Maps, Tripadvisor).`,
          "Return the 6-10 topics that matter most to people deciding whether to choose this brand. For each topic:",
          '"topic" (1-3 words, Title Case); "customers" and "ai": how each side treats it - "positive", "negative", "mixed", or "none" when that side doesn\'t raise it;',
          '"status": "aligned" (both agree), "missing" (customers raise it, AI answers don\'t), "contradicts" (they disagree), or "ai-only" (AI claims it, customers don\'t raise it);',
          '"note": one sentence (max 25 words) with the evidence and what it means for the brand.',
          "Prioritise strengths customers love that AI misses, and AI claims customers contradict. Only use the evidence given.",
          'Also "summary": two sentences on how well AI answers reflect the real customer experience.',
          'Return ONLY JSON: {"summary": string, "items": [{"topic": string, "customers": string, "ai": string, "status": string, "note": string}]}.',
        ].join(" "),
      },
      { role: "user", content: `WHAT CUSTOMERS SAY\n${customerLines.join("\n")}\n\nWHAT AI ANSWERS SAY\n${aiLines.join("\n")}` },
    ],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { summary?: unknown; items?: unknown };
  const items: CustomerGapItem[] = (Array.isArray(raw.items) ? raw.items : [])
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({
      topic: str(x.topic, 60),
      customers: GAP_TONES.includes(x.customers as GapTone) ? (x.customers as GapTone) : "none",
      ai: GAP_TONES.includes(x.ai as GapTone) ? (x.ai as GapTone) : "none",
      status: GAP_STATUSES.includes(x.status as GapStatus) ? (x.status as GapStatus) : "aligned",
      note: str(x.note, 240),
    }))
    .filter((x) => x.topic)
    .slice(0, 12);
  return { summary: str(raw.summary, 600), items, costUsd: completionCost(completion.usage) };
}

function mockGap(ai: AiClaimGroup[], voice: CustomerVoice): { summary: string; items: CustomerGapItem[] } {
  const aiTone = (topic: string): GapTone => {
    const words = topic.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    const g = ai.find((a) => words.some((w) => a.attribute.toLowerCase().includes(w)));
    if (!g) return "none";
    return g.positive && g.negative ? "mixed" : g.negative > g.positive ? "negative" : "positive";
  };
  const items: CustomerGapItem[] = [
    ...voice.praise.slice(0, 4).map((a) => {
      const t = aiTone(a.aspect);
      return {
        topic: a.aspect,
        customers: "positive" as GapTone,
        ai: t,
        status: (t === "none" ? "missing" : t === "negative" ? "contradicts" : "aligned") as GapStatus,
        note: t === "none" ? `${a.share}% of reviews praise this, but AI answers don't mention it.` : `Praised in ${a.share}% of reviews; AI answers ${t === "negative" ? "are critical" : "agree"}.`,
      };
    }),
    ...voice.criticism
      .filter((a) => !voice.praise.slice(0, 4).some((p) => p.aspect === a.aspect))
      .slice(0, 3)
      .map((a) => {
      const t = aiTone(a.aspect);
      return {
        topic: a.aspect,
        customers: "negative" as GapTone,
        ai: t,
        status: (t === "none" ? "missing" : t === "positive" ? "contradicts" : "aligned") as GapStatus,
        note: t === "positive" ? `AI answers praise this, but ${a.share}% of reviews complain about it.` : `${a.share}% of reviews criticise this${t === "none" ? "; AI answers don't raise it" : ", and AI answers agree"}.`,
      };
    }),
    ...ai
      .filter((g) => !voice.praise.concat(voice.criticism).some((a) => aiTone(a.aspect) !== "none" && g.attribute.toLowerCase().includes(a.aspect.toLowerCase().split(/[^a-z]+/)[0] ?? "")))
      .slice(0, 2)
      .map((g) => ({
        topic: g.attribute,
        customers: "none" as GapTone,
        ai: (g.negative > g.positive ? "negative" : "positive") as GapTone,
        status: "ai-only" as GapStatus,
        note: `AI answers bring this up (${g.positive + g.negative + g.neutral} claims), but reviews rarely do.`,
      })),
  ];
  return {
    summary: "Placeholder comparison (no OpenAI key): AI answers echo some of what customers praise, but miss several strengths reviewers mention often. Add the OpenAI key for a real comparison.",
    items,
  };
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

function mockSuggestions(brand: TrackedBrand, competitors: TrackedCompetitor[], keywords: string[], count: number, context?: SuggestContext): SuggestedPrompt[] {
  const name = brand.name || "this brand";
  const rivals = competitors.length ? competitors.map((c) => c.name) : ["Heritage Line", "Paradise Cruises"];
  const place = keywords[0] ?? "Halong Bay cruise";
  const travellers = context?.travellers.length ? context.travellers.map((t) => t.toLowerCase()) : ["couples", "families"];
  const base: SuggestedPrompt[] = [
    { text: `${name} vs ${rivals[0]}: which is better for a honeymoon?`, topic: "Comparisons" },
    { text: `${name} or ${rivals[1] ?? rivals[0]} for a family with young kids?`, topic: "Comparisons" },
    { text: `Is ${name} worth the price for ${travellers[0]}?`, topic: "Worth it?" },
    { text: `Pros and cons of ${name} compared with other luxury options`, topic: "Worth it?" },
    { text: `${name} reviews: what do guests say about the service and food?`, topic: "Reviews" },
    { text: `Who is ${name} best suited for?`, topic: "Who it suits" },
    { text: `Is ${name} a good choice for ${travellers[1] ?? "solo travellers"}?`, topic: "Who it suits" },
    { text: `Best ${place} for a honeymoon`, topic: "Best for" },
    { text: `Best luxury ${place} for families with young children`, topic: "Best for" },
    { text: `Which ${place} is best for a quiet trip away from the crowds?`, topic: "Right fit" },
    { text: `Which ${place} suits travellers with limited mobility?`, topic: "Right fit" },
    { text: `Best ${place} for a special birthday or anniversary`, topic: "Best for" },
  ];
  return base.slice(0, count);
}
