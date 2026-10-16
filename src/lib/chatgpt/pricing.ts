import { priceOf } from "../brand/pricing";

/**
 * Models offered for ChatGPT Mentions and the cost estimate of a run. Prices (USD per 1M tokens) come from the
 * shared price list in brand/pricing; a model not listed there is priced like the flagship, so estimates and the
 * daily limit err on the safe side. Safe to import in the browser.
 */

export interface MentionsModel {
  id: string;
  label: string;
  note: string;
  /** Reasoning models spend extra output tokens thinking before they answer. */
  reasoning: boolean;
}

export const MENTIONS_MODELS: MentionsModel[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini", note: "Cheapest. Short, list-style answers.", reasoning: false },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", note: "A little more detail than 4o mini, about 2.5x the cost.", reasoning: false },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano", note: "Newest small model; reasons briefly before answering.", reasoning: true },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", note: "Closest to ChatGPT's everyday answers at a moderate cost.", reasoning: true },
  { id: "gpt-5.5", label: "GPT-5.5", note: "OpenAI's flagship - the most ChatGPT-like answers, the highest cost.", reasoning: true },
];

export const FALLBACK_MODEL = "gpt-4o-mini";

export function isReasoningModel(model: string): boolean {
  const known = MENTIONS_MODELS.find((m) => m.id === model || model.startsWith(`${m.id}-`));
  return known ? known.reasoning : /^(gpt-5|o\d)/.test(model);
}

export function modelLabel(model: string): string {
  return MENTIONS_MODELS.find((m) => m.id === model)?.label ?? model;
}

/** USD per 1M input / output tokens. */
export function modelPrice(model: string): { input: number; output: number } {
  const p = priceOf(model);
  return { input: p.input, output: p.output };
}

export function usageCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Longest answer requested from the model; reasoning models get room to think first. */
export function answerTokenLimit(model: string): number {
  return isReasoningModel(model) ? 1500 : 500;
}

export interface RunEstimate {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  parts: Array<{ label: string; calls: number; costUsd: number }>;
  totalUsd: number;
}

const EXTRACT_CHUNK = 20;

/**
 * Typical cost of a run: one call per location to write the prompt variations, one per prompt to answer it, and
 * the leaderboard pass (answers re-read in chunks of 20, then one call to merge name variants). Based on typical
 * answer lengths, so a real run usually lands within about ±30%.
 */
export function estimateRun(model: string, prompts: number, locations: number): RunEstimate {
  const reasoning = isReasoningModel(model);
  const segments = Math.max(1, locations);
  const answerOut = reasoning ? 900 : 380;
  const chunks = Math.ceil(prompts / EXTRACT_CHUNK);
  const names = Math.min(400, prompts * 2);
  const rows = [
    { label: "Prompt variations", calls: segments, input: segments * 230, output: prompts * 30 + segments * 20 + (reasoning ? segments * 400 : 0) },
    { label: "Answers", calls: prompts, input: prompts * 55, output: prompts * answerOut },
    {
      label: "Leaderboard",
      calls: prompts > 0 ? chunks + 1 : 0,
      input: prompts > 0 ? chunks * 170 + prompts * 420 + 220 + names * 10 : 0,
      output: prompts > 0 ? prompts * (reasoning ? 160 : 70) + names * 18 : 0,
    },
  ];
  const parts = rows.map((r) => ({ label: r.label, calls: r.calls, costUsd: usageCost(model, r.input, r.output) }));
  return {
    model,
    calls: rows.reduce((n, r) => n + r.calls, 0),
    inputTokens: rows.reduce((n, r) => n + r.input, 0),
    outputTokens: rows.reduce((n, r) => n + r.output, 0),
    parts,
    totalUsd: parts.reduce((n, p) => n + p.costUsd, 0),
  };
}

export const fmtUsd = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** A per-1M-token price: "$0.15", "$0.075", "$5". */
export const fmtPrice = (v: number): string => `$${Number(v.toFixed(3))}`;

/** Key fingerprint: never the key itself. The server key is "server"; a visitor's key is a hash prefix. */
export const SERVER_KEY_ID = "server";
export const keyIdFromHash = (sha256Hex: string) => `k_${sha256Hex.slice(0, 16)}`;
export const keyLabel = (key: string) => `sk-…${key.trim().slice(-4)}`;
