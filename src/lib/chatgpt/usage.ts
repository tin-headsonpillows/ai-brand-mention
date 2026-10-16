import { createHash } from "crypto";
import { readJson, writeJson } from "../blobJson";
import { FALLBACK_MODEL, SERVER_KEY_ID, keyIdFromHash, keyLabel, usageCost } from "./pricing";

/**
 * ChatGPT Mentions API usage: every OpenAI call's tokens and cost, per model and per API key, by UTC day, kept in
 * one document per month. Keys are identified by a fingerprint (a hash prefix plus the last 4 characters for
 * display) - the key itself is never stored. Each key has a daily spending limit that is checked before every call.
 */

export const DEFAULT_DAILY_LIMIT = 5;
const settingsPath = "chatgpt/settings.json";
const monthPath = (month: string) => `chatgpt/usage/${month}.json`;

export interface UsageTotals {
  calls: number;
  input: number;
  output: number;
  costUsd: number;
}

export interface DayUsage {
  byModel: Record<string, UsageTotals>;
  byKey: Record<string, UsageTotals>;
  runs: number;
}

interface MonthDoc {
  month: string;
  days: Record<string, DayUsage>;
}

export interface KeyInfo {
  label: string;
  firstSeen: string;
  lastUsed: string;
}

export interface MentionsSettings {
  /** Default model for runs; null = OPENAI_MODEL or gpt-4o-mini. */
  model: string | null;
  /** Daily limit (USD) for any key without its own. */
  dailyLimitUsd: number;
  keyLimits: Record<string, number>;
  keys: Record<string, KeyInfo>;
}

export const today = () => new Date().toISOString().slice(0, 10);

export function serverDefaultModel(): string {
  return process.env.OPENAI_MODEL?.trim() || FALLBACK_MODEL;
}

export async function readSettings(): Promise<MentionsSettings> {
  const s = (await readJson<Partial<MentionsSettings>>(settingsPath)) ?? {};
  return {
    model: typeof s.model === "string" && s.model.trim() ? s.model.trim() : null,
    dailyLimitUsd: typeof s.dailyLimitUsd === "number" && s.dailyLimitUsd >= 0 ? s.dailyLimitUsd : DEFAULT_DAILY_LIMIT,
    keyLimits: s.keyLimits ?? {},
    keys: s.keys ?? {},
  };
}

export async function writeSettings(update: (s: MentionsSettings) => MentionsSettings): Promise<MentionsSettings> {
  const next = update(await readSettings());
  await writeJson(settingsPath, next);
  return next;
}

const clampUsd = (v: number) => Math.round(Math.max(0, Math.min(10_000, v)) * 100) / 100;
export { clampUsd };

/** The key a request runs on: the visitor's own key, or the server's OPENAI_API_KEY. */
export function identifyKey(userKey?: string): { id: string; label: string } {
  const key = userKey?.trim();
  if (!key) return { id: SERVER_KEY_ID, label: "Server key" };
  return { id: keyIdFromHash(createHash("sha256").update(key).digest("hex")), label: keyLabel(key) };
}

export function limitFor(settings: MentionsSettings, keyId: string): number {
  const own = settings.keyLimits[keyId];
  return typeof own === "number" ? own : settings.dailyLimitUsd;
}

export async function readMonth(month: string): Promise<MonthDoc> {
  return (await readJson<MonthDoc>(monthPath(month))) ?? { month, days: {} };
}

export async function spentToday(keyId: string): Promise<number> {
  const day = today();
  const doc = await readMonth(day.slice(0, 7));
  return doc.days[day]?.byKey[keyId]?.costUsd ?? 0;
}

/** Days with usage over the last `months` calendar months, oldest first. */
export async function usageHistory(months = 13): Promise<Array<{ day: string } & DayUsage>> {
  const now = new Date();
  const ids = Array.from({ length: months }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const docs = await Promise.all(ids.map(readMonth));
  return docs
    .flatMap((d) => Object.entries(d.days).map(([day, usage]) => ({ day, ...usage })))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

const empty = (): UsageTotals => ({ calls: 0, input: 0, output: 0, costUsd: 0 });
const add = (t: UsageTotals, d: UsageTotals) => {
  t.calls += d.calls;
  t.input += d.input;
  t.output += d.output;
  t.costUsd += d.costUsd;
};

export class BudgetExceeded extends Error {
  constructor(
    public spent: number,
    public limit: number,
    public keyLabel: string
  ) {
    super(`Daily limit reached for ${keyLabel}: $${spent.toFixed(2)} of $${limit.toFixed(2)} spent today (UTC). Raise it in Settings or try again tomorrow.`);
    this.name = "BudgetExceeded";
  }
}

/**
 * Meters one run's OpenAI calls against its key's daily limit. Before a call, its worst-case cost is reserved
 * (so parallel calls can't overshoot together); after it, the real cost replaces the reservation. Usage is
 * written to the ledger in batches and when the run ends. Two runs on the same key at once can each spend up to
 * what was left when they started.
 */
export class UsageMeter {
  private reserved = 0;
  private pending = new Map<string, UsageTotals>();
  private writing: Promise<void> = Promise.resolve();
  private sinceFlush = 0;
  readonly run = empty();

  constructor(
    readonly keyId: string,
    readonly keyLabel: string,
    readonly limitUsd: number,
    readonly spentBefore: number
  ) {}

  get spentToday(): number {
    return this.spentBefore + this.run.costUsd;
  }

  /** Reserves the call's worst case, or throws BudgetExceeded when it would pass the limit. */
  reserve(expectedUsd: number): number {
    if (this.spentBefore + this.run.costUsd + this.reserved + expectedUsd > this.limitUsd) {
      throw new BudgetExceeded(this.spentBefore + this.run.costUsd, this.limitUsd, this.keyLabel);
    }
    this.reserved += expectedUsd;
    return expectedUsd;
  }

  release(reservation: number): void {
    this.reserved = Math.max(0, this.reserved - reservation);
  }

  record(reservation: number, model: string, input: number, output: number): void {
    this.release(reservation);
    const delta = { calls: 1, input, output, costUsd: usageCost(model, input, output) };
    add(this.run, delta);
    const totals = this.pending.get(model) ?? empty();
    add(totals, delta);
    this.pending.set(model, totals);
    if (++this.sinceFlush >= 15) void this.flush();
  }

  /** Writes recorded usage to the ledger (serialized, so batches never overwrite each other). */
  flush(countRun = false): Promise<void> {
    const batch = this.pending;
    this.pending = new Map();
    this.sinceFlush = 0;
    if (batch.size === 0 && !countRun) return this.writing;
    this.writing = this.writing.then(async () => {
      const day = today();
      const doc = await readMonth(day.slice(0, 7));
      const usage = doc.days[day] ?? { byModel: {}, byKey: {}, runs: 0 };
      const keyTotals = usage.byKey[this.keyId] ?? empty();
      for (const [model, delta] of batch) {
        const t = usage.byModel[model] ?? empty();
        add(t, delta);
        usage.byModel[model] = t;
        add(keyTotals, delta);
      }
      usage.byKey[this.keyId] = keyTotals;
      if (countRun) usage.runs += 1;
      doc.days[day] = usage;
      await writeJson(monthPath(doc.month), doc);
    }).catch(() => {
      // A failed ledger write must not break the run; the next flush retries with newer usage only.
    });
    return this.writing;
  }
}

/** Sets up the meter for a run: remembers the key (label only) and reads what it has spent today. */
export async function startMeter(userKey?: string): Promise<{ meter: UsageMeter; settings: MentionsSettings }> {
  const key = identifyKey(userKey);
  const now = new Date().toISOString();
  const settings = await writeSettings((s) => ({
    ...s,
    keys: { ...s.keys, [key.id]: { label: key.label, firstSeen: s.keys[key.id]?.firstSeen ?? now, lastUsed: now } },
  }));
  const spent = await spentToday(key.id);
  return { meter: new UsageMeter(key.id, key.label, limitFor(settings, key.id), spent), settings };
}
