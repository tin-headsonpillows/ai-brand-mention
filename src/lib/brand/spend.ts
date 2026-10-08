import { readJson, writeJson } from "../blobJson";

/**
 * Daily spending cap for paid LLM calls made by Brand Mentions (ChatGPT, Claude and the analysis model), shared
 * by every project. Each call is recorded after it returns; before a call, the expected cost is checked against
 * what's left today (UTC day). Writes are read-modify-write, so two runs at the same moment can overshoot by
 * roughly one call - small next to the cap.
 */
export const DEFAULT_DAILY_LIMIT = 5;
const settingsPath = "brand/global.json";
const dayPath = (day: string) => `brand/spend/${day}.json`;

export interface DaySpend {
  day: string;
  totalUsd: number;
  byProvider: { openai: number; anthropic: number };
  calls: number;
}

export const today = () => new Date().toISOString().slice(0, 10);

export async function dailyLimit(): Promise<number> {
  const s = await readJson<{ dailyLimitUsd?: number }>(settingsPath);
  return typeof s?.dailyLimitUsd === "number" && s.dailyLimitUsd >= 0 ? s.dailyLimitUsd : DEFAULT_DAILY_LIMIT;
}

export async function setDailyLimit(value: number): Promise<void> {
  const current = (await readJson<Record<string, unknown>>(settingsPath)) ?? {};
  await writeJson(settingsPath, { ...current, dailyLimitUsd: Math.round(Math.max(0, Math.min(1000, value)) * 100) / 100 });
}

export async function spentToday(): Promise<DaySpend> {
  const day = today();
  return (await readJson<DaySpend>(dayPath(day))) ?? { day, totalUsd: 0, byProvider: { openai: 0, anthropic: 0 }, calls: 0 };
}

export async function recordSpend(provider: "openai" | "anthropic", usd: number): Promise<void> {
  if (!(usd > 0)) return;
  const current = await spentToday();
  current.totalUsd += usd;
  current.byProvider[provider] += usd;
  current.calls += 1;
  await writeJson(dayPath(current.day), current);
}

export class BudgetExceeded extends Error {
  constructor(public spent: number, public limit: number) {
    super(`Daily AI spending limit reached ($${spent.toFixed(2)} of $${limit.toFixed(2)}). The rest continues tomorrow.`);
  }
}

/** Throws BudgetExceeded when today's spend plus the expected cost would pass the limit. */
export async function ensureBudget(expectedUsd: number): Promise<void> {
  const [spend, limit] = await Promise.all([spentToday(), dailyLimit()]);
  if (spend.totalUsd + expectedUsd > limit) throw new BudgetExceeded(spend.totalUsd, limit);
}

/** Recent days for the cost panel. */
export async function recentSpend(days = 14): Promise<DaySpend[]> {
  const out: DaySpend[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    out.push((await readJson<DaySpend>(dayPath(day))) ?? { day, totalUsd: 0, byProvider: { openai: 0, anthropic: 0 }, calls: 0 });
  }
  return out;
}
