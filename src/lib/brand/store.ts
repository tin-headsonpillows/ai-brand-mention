import { readJson, writeJson, deleteJson } from "../blobJson";
import { DEFAULT_CHATGPT_MODEL, DEFAULT_CLAUDE_MODEL } from "./pricing";
import type { BrandPrompt, BrandSettings, CustomerGap, Cycle, CycleSummary, FactVerdict } from "./types";

/** Per project: prompts, settings, a list of tracking cycles and one file per cycle with every answer. */
const base = (projectId: string) => `brand/${projectId}`;
const promptsPath = (p: string) => `${base(p)}/prompts.json`;
const settingsPath = (p: string) => `${base(p)}/settings.json`;
const cyclesPath = (p: string) => `${base(p)}/cycles.json`;
const cyclePath = (p: string, id: string) => `${base(p)}/cycles/${id}.json`;
const factsPath = (p: string) => `${base(p)}/facts.json`;
const gapPath = (p: string) => `${base(p)}/customer-gap.json`;

export const MAX_PROMPTS = 200;

export function defaultSettings(): BrandSettings {
  return {
    platforms: { aiMode: true, aiOverview: true, chatgpt: true, claude: true },
    chatgptModel: DEFAULT_CHATGPT_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    schedule: "weekly",
    refreshReviews: true,
  };
}

export async function readPrompts(projectId: string): Promise<BrandPrompt[]> {
  return (await readJson<{ prompts: BrandPrompt[] }>(promptsPath(projectId)))?.prompts ?? [];
}

export async function writePrompts(projectId: string, prompts: BrandPrompt[]): Promise<void> {
  await writeJson(promptsPath(projectId), { prompts: prompts.slice(0, MAX_PROMPTS) });
}

export async function readSettings(projectId: string): Promise<BrandSettings> {
  const saved = await readJson<Partial<BrandSettings>>(settingsPath(projectId));
  const d = defaultSettings();
  return { ...d, ...saved, platforms: { ...d.platforms, ...(saved?.platforms ?? {}) } };
}

export async function writeSettings(projectId: string, settings: BrandSettings): Promise<void> {
  await writeJson(settingsPath(projectId), settings);
}

export async function listCycles(projectId: string): Promise<CycleSummary[]> {
  return (await readJson<{ cycles: CycleSummary[] }>(cyclesPath(projectId)))?.cycles ?? [];
}

export async function writeCycles(projectId: string, cycles: CycleSummary[]): Promise<void> {
  await writeJson(cyclesPath(projectId), { cycles });
}

export async function updateCycleSummary(projectId: string, id: string, patch: Partial<CycleSummary>): Promise<CycleSummary | null> {
  const cycles = await listCycles(projectId);
  const index = cycles.findIndex((c) => c.id === id);
  if (index < 0) return null;
  cycles[index] = { ...cycles[index], ...patch };
  await writeCycles(projectId, cycles);
  return cycles[index];
}

export async function readCycle(projectId: string, id: string): Promise<Cycle | null> {
  if (!/^[\w-]{1,60}$/.test(id)) return null;
  return readJson<Cycle>(cyclePath(projectId, id));
}

export async function writeCycle(projectId: string, cycle: Cycle): Promise<void> {
  await writeJson(cyclePath(projectId, cycle.id), cycle);
}

export async function deleteCycle(projectId: string, id: string): Promise<void> {
  await writeCycles(projectId, (await listCycles(projectId)).filter((c) => c.id !== id));
  await deleteJson([cyclePath(projectId, id)]).catch(() => {
    // Already out of the list.
  });
}

export async function readFacts(projectId: string): Promise<Record<string, FactVerdict>> {
  return (await readJson<{ verdicts: Record<string, FactVerdict> }>(factsPath(projectId)))?.verdicts ?? {};
}

export async function setFact(projectId: string, key: string, verdict: FactVerdict | null): Promise<Record<string, FactVerdict>> {
  const verdicts = await readFacts(projectId);
  if (verdict) verdicts[key] = verdict;
  else delete verdicts[key];
  await writeJson(factsPath(projectId), { verdicts });
  return verdicts;
}

/** Stable key for a fact statement, so a verdict survives re-runs that repeat the same claim. */
export function factKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 120);
}

export async function readCustomerGap(projectId: string): Promise<CustomerGap | null> {
  return readJson<CustomerGap>(gapPath(projectId));
}

export async function writeCustomerGap(projectId: string, gap: CustomerGap): Promise<void> {
  await writeJson(gapPath(projectId), gap);
}
