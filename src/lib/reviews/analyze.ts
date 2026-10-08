import { createChatCompletion } from "../execute";
import { OTHER_ASPECT } from "./analyze-shared";
import type { PlaceRef, Review, ReviewAnalysis, ReviewPoint, Sentiment } from "./types";
const MAX_ASPECTS = 14;
const MAX_POINTS_PER_REVIEW = 6;

/** The text to analyse: Google's English translation when there is one, after the review's headline (Tripadvisor). */
export function analysisText(review: Review): string {
  const body = (review.textEn ?? review.text).trim();
  const title = review.title?.trim();
  if (!title || body.toLowerCase().startsWith(title.toLowerCase())) return body;
  return body ? `${title}${/[.!?]$/.test(title) ? "" : "."} ${body}` : title;
}

function ratingSentiment(rating: number | null): Sentiment {
  if (rating === null) return "neutral";
  if (rating >= 4) return "positive";
  if (rating <= 2) return "negative";
  return "neutral";
}

function overallFromPoints(points: ReviewPoint[], rating: number | null): Sentiment {
  const pos = points.some((p) => p.sentiment === "positive");
  const neg = points.some((p) => p.sentiment === "negative");
  if (pos && neg) return "mixed";
  if (pos) return "positive";
  if (neg) return "negative";
  return ratingSentiment(rating);
}

// ---------------------------------------------------------------------------------------------
// Model-based analysis
// ---------------------------------------------------------------------------------------------

/**
 * Picks the aspects this business's reviews talk about, from a sample. Fixing them once per place keeps
 * every period and every refresh sorted into the same rows of the heatmap.
 */
export async function buildTaxonomy(
  place: PlaceRef,
  sample: Review[],
  topics: Array<{ keyword: string }>,
  model: string
): Promise<string[]> {
  const listing = sample
    .map(analysisText)
    .filter(Boolean)
    .slice(0, 80)
    .map((t, i) => `[${i}] ${t.slice(0, 500)}`)
    .join("\n");
  try {
    const completion = await createChatCompletion({
      model,
      messages: [
        {
          role: "system",
          content: [
            `You design the categories for analysing customer reviews of one business${place.type ? ` (a ${place.type})` : ""}.`,
            `Read the sample reviews and return 8-${MAX_ASPECTS} aspects customers actually praise or criticise, specific enough to act on`,
            '(e.g. "Breakfast", "Room Cleanliness", "Front Desk Staff", "Pool", "Value for Money", "Noise") but broad enough that each covers many reviews.',
            "Aspects must not overlap. Use short Title Case names (1-3 words).",
            'Return ONLY JSON: {"aspects": string[]}.',
          ].join(" "),
        },
        {
          role: "user",
          content: `Business: ${place.name}\n${topics.length ? `Google's review topics: ${topics.map((t) => t.keyword).join(", ")}\n` : ""}\nSample reviews:\n${listing}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { aspects?: unknown };
    const aspects = Array.isArray(parsed.aspects)
      ? Array.from(
          new Set(
            parsed.aspects
              .filter((a): a is string => typeof a === "string")
              .map((a) => a.trim())
              .filter((a) => a && a.toLowerCase() !== "other")
          )
        ).slice(0, MAX_ASPECTS)
      : [];
    return aspects.length >= 3 ? aspects : HEURISTIC_RULES.map((r) => r.aspect);
  } catch {
    return HEURISTIC_RULES.map((r) => r.aspect);
  }
}

function matchAspect(raw: string, taxonomy: string[]): string {
  const value = raw.trim().toLowerCase();
  const exact = taxonomy.find((a) => a.toLowerCase() === value);
  if (exact) return exact;
  const partial = taxonomy.find((a) => value.includes(a.toLowerCase()) || a.toLowerCase().includes(value));
  return partial ?? OTHER_ASPECT;
}

interface BatchOutput {
  reviews?: Array<{ i?: unknown; sentiment?: unknown; points?: unknown }>;
}

/** Sentiment + points of praise/criticism for a batch of reviews (keyed by review id). */
export async function analyzeBatch(
  reviews: Review[],
  taxonomy: string[],
  model: string
): Promise<Map<string, ReviewAnalysis>> {
  const out = new Map<string, ReviewAnalysis>();
  const withText = reviews.filter((r) => analysisText(r));
  for (const r of reviews) {
    if (!analysisText(r)) out.set(r.id, { sentiment: ratingSentiment(r.rating), points: [] });
  }
  if (withText.length === 0) return out;

  const listing = withText
    .map((r, i) => `[${i}] (${r.rating ?? "?"}/5) ${analysisText(r).slice(0, 1500)}`)
    .join("\n\n");
  const completion = await createChatCompletion({
    model,
    messages: [
      {
        role: "system",
        content: [
          "You analyse customer reviews. For each numbered review give its overall sentiment",
          '("positive", "negative", "mixed" when it clearly praises and criticises, or "neutral") and every specific point of praise or criticism it makes.',
          `Each point names exactly one aspect from this list: ${taxonomy.map((a) => `"${a}"`).join(", ")} - or "${OTHER_ASPECT}" if none fits -`,
          'its sentiment ("positive" or "negative"), and a short quote (max 12 words, in English, translated if needed) from the review that carries it.',
          `At most ${MAX_POINTS_PER_REVIEW} points per review; skip vague filler like "great place".`,
          'Return ONLY JSON: {"reviews": [{"i": number, "sentiment": string, "points": [{"aspect": string, "sentiment": string, "quote": string}]}]}.',
        ].join(" "),
      },
      { role: "user", content: listing },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as BatchOutput;

  for (const item of parsed.reviews ?? []) {
    const index = Number(item.i);
    const review = withText[index];
    if (!review) continue;
    const points: ReviewPoint[] = (Array.isArray(item.points) ? item.points : [])
      .map((p) => p as { aspect?: unknown; sentiment?: unknown; quote?: unknown })
      .filter((p) => typeof p.aspect === "string" && (p.sentiment === "positive" || p.sentiment === "negative"))
      .slice(0, MAX_POINTS_PER_REVIEW)
      .map((p) => ({
        aspect: matchAspect(p.aspect as string, taxonomy),
        sentiment: p.sentiment as "positive" | "negative",
        quote: typeof p.quote === "string" ? p.quote.trim().slice(0, 160) : "",
      }));
    const sentiment =
      item.sentiment === "positive" || item.sentiment === "negative" || item.sentiment === "mixed" || item.sentiment === "neutral"
        ? item.sentiment
        : overallFromPoints(points, review.rating);
    out.set(review.id, { sentiment, points });
  }
  // Reviews the model skipped are retried on the next sync rather than stored half-analysed.
  return out;
}

// ---------------------------------------------------------------------------------------------
// Heuristic analysis (no OpenAI key): keyword aspects + a small sentiment lexicon
// ---------------------------------------------------------------------------------------------

const HEURISTIC_RULES: Array<{ aspect: string; pattern: RegExp }> = [
  { aspect: "Staff & Service", pattern: /\b(staff|service|reception|receptionist|employee|waiter|waitress|manager|host|team|friendly|rude|helpful)\b/i },
  { aspect: "Cleanliness", pattern: /\b(clean|cleanliness|dirty|spotless|dust|dusty|stain|smell|smelled|musty|hygiene)\b/i },
  { aspect: "Room & Comfort", pattern: /\b(room|rooms|bed|beds|bathroom|shower|pillow|mattress|aircon|air conditioning|balcony)\b/i },
  { aspect: "Food & Drinks", pattern: /\b(food|breakfast|buffet|dinner|lunch|restaurant|menu|coffee|drink|drinks|bar|meal|dish)\b/i },
  { aspect: "Location", pattern: /\b(location|located|beach|walking distance|close to|near|central|area)\b/i },
  { aspect: "View", pattern: /\b(view|views|ocean view|sea view|scenery)\b/i },
  { aspect: "Pool & Facilities", pattern: /\b(pool|gym|spa|facilities|facility|elevator|lift|parking|kids club)\b/i },
  { aspect: "Value for Money", pattern: /\b(price|prices|value|expensive|cheap|overpriced|worth|cost|money|affordable)\b/i },
  { aspect: "Check-in & Check-out", pattern: /\b(check-?in|check-?out|checkin|checkout|front desk|arrival)\b/i },
  { aspect: "Noise", pattern: /\b(noise|noisy|loud|quiet|construction)\b/i },
  { aspect: "Wi-Fi", pattern: /\b(wi-?fi|internet|connection)\b/i },
  { aspect: "Atmosphere", pattern: /\b(atmosphere|vibe|ambience|ambiance|decor|music)\b/i },
];

const GENERIC_ASPECT = "Room & Comfort";

const POSITIVE_WORDS =
  /\b(great|excellent|amazing|awesome|friendly|helpful|clean|spotless|beautiful|perfect|lovely|nice|good|best|delicious|comfortable|wonderful|fantastic|quick|smooth|recommend|variety|stunning|well kept|great value|worth|attentive|quiet)\b/gi;
const NEGATIVE_WORDS =
  /\b(bad|terrible|awful|rude|dirty|musty|smell|smelled|noisy|loud|slow|broken|closed|crowded|ran out|overpriced|expensive|disappointing|disappointed|poor|worst|unhelpful|cold|dropping|uncomfortable|over an hour|not clean|never again)\b/gi;

function sentenceScore(sentence: string): number {
  const pos = sentence.match(POSITIVE_WORDS)?.length ?? 0;
  const neg = sentence.match(NEGATIVE_WORDS)?.length ?? 0;
  const negated = /\b(not|wasn't|weren't|isn't|no|never|didn't)\s+(\w+\s+)?(clean|good|great|friendly|helpful|comfortable|worth)\b/i.test(sentence);
  return pos - neg - (negated ? 2 : 0);
}

export function heuristicTaxonomy(): string[] {
  return HEURISTIC_RULES.map((r) => r.aspect);
}

export function analyzeHeuristic(review: Review): ReviewAnalysis {
  const text = analysisText(review);
  if (!text) return { sentiment: ratingSentiment(review.rating), points: [] };
  const fallback = ratingSentiment(review.rating);
  const points: ReviewPoint[] = [];
  const seen = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\s+but\s+|;\s*/i)) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const score = sentenceScore(trimmed);
    const sentiment: ReviewPoint["sentiment"] | null =
      score > 0 ? "positive" : score < 0 ? "negative" : fallback === "positive" || fallback === "negative" ? fallback : null;
    if (!sentiment) continue;
    // "Room" is mentioned in passing all the time ("wifi in the room"); it only counts when nothing more specific does.
    let matched = HEURISTIC_RULES.filter((rule) => rule.aspect !== GENERIC_ASPECT && rule.pattern.test(trimmed));
    if (matched.length === 0) matched = HEURISTIC_RULES.filter((rule) => rule.aspect === GENERIC_ASPECT && rule.pattern.test(trimmed));
    for (const rule of matched) {
      const key = `${rule.aspect}|${sentiment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ aspect: rule.aspect, sentiment, quote: trimmed.slice(0, 120) });
    }
  }
  return { sentiment: overallFromPoints(points, review.rating), points: points.slice(0, MAX_POINTS_PER_REVIEW) };
}
