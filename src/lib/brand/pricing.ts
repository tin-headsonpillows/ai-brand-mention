import type { Platform } from "./types";

/**
 * Model prices (USD per 1M tokens) and per-answer estimates used for the cost projection and the daily
 * spending cap. Prices from OpenAI's and Anthropic's pricing pages (October 2026). Web search is billed on top:
 * $10 per 1,000 searches on both, with the fetched page content counted as input tokens.
 */

export interface LlmModel {
  id: string;
  label: string;
  provider: "openai" | "anthropic";
  input: number;
  output: number;
  cachedInput?: number;
  note: string;
  /** Typical tokens for one web-search answer (search content included), for estimates before real usage exists. */
  typical: { input: number; output: number; searches: number };
}

export const WEB_SEARCH_PER_CALL = 0.01;

export const CHATGPT_MODELS: LlmModel[] = [
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    provider: "openai",
    input: 0.75,
    cachedInput: 0.075,
    output: 4.5,
    note: "Cheap and fast; close to ChatGPT's everyday answers.",
    typical: { input: 8000, output: 900, searches: 1 },
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    provider: "openai",
    input: 5,
    cachedInput: 0.5,
    output: 30,
    note: "OpenAI's flagship; the most ChatGPT-like answers, ~4x the cost.",
    typical: { input: 8000, output: 1000, searches: 1 },
  },
];

export const CLAUDE_MODELS: LlmModel[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    input: 4,
    cachedInput: 0.2,
    output: 20,
    note: "Anthropic's current flagship (default).",
    typical: { input: 15000, output: 1200, searches: 2 },
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    input: 2,
    cachedInput: 0.2,
    output: 10,
    note: "About half the cost of Opus, strong answers.",
    typical: { input: 15000, output: 1200, searches: 2 },
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    provider: "anthropic",
    input: 0.1,
    output: 0.5,
    note: "Cheapest; most of the cost is the web searches.",
    typical: { input: 15000, output: 1000, searches: 2 },
  },
];

/** Models a Claude fallback may land on (priced so the ledger stays right). */
const OTHER_MODELS: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
};

export const DEFAULT_CHATGPT_MODEL = "gpt-5.4-mini";
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

/** The answers are analysed (mentions, sentiment, claims) with this model, about 5k tokens in and 800 out each. */
export const ANALYSIS_TYPICAL = { input: 5000, output: 800 };

export function priceOf(model: string): { input: number; output: number; cachedInput?: number } {
  const known = [...CHATGPT_MODELS, ...CLAUDE_MODELS].find((m) => m.id === model || model.startsWith(`${m.id}-`));
  if (known) return known;
  const key = Object.keys(OTHER_MODELS).find((k) => model === k || model.startsWith(`${k}-`));
  // Unknown models are priced like the flagship so the cap errs on the safe side.
  return key ? OTHER_MODELS[key] : { input: 5, output: 30 };
}

export function tokenCost(model: string, usage: { input: number; output: number; cachedInput?: number }): number {
  const p = priceOf(model);
  const cached = usage.cachedInput ?? 0;
  return ((usage.input - cached) * p.input + cached * (p.cachedInput ?? p.input) + usage.output * p.output) / 1_000_000;
}

export function typicalAnswerCost(model: LlmModel): number {
  return tokenCost(model.id, { input: model.typical.input, output: model.typical.output }) + model.typical.searches * WEB_SEARCH_PER_CALL;
}

export function analysisCost(model: string): number {
  return tokenCost(model, ANALYSIS_TYPICAL);
}

/** SerpApi credits per prompt: AI Mode is one search; AI Overview is a Google search plus, usually, one to load it. */
export const SERP_CREDITS: Record<Platform, number> = { aiMode: 1, aiOverview: 2, chatgpt: 0, claude: 0 };

export interface Projection {
  perRun: { chatgpt: number; claude: number; analysis: number; total: number; serpCredits: number };
  perWeek: number;
  perMonth: number;
  basis: "observed" | "estimate";
}
