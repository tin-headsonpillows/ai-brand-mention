import { listProjectIds, readConfig } from "../tracking/store";
import type { TrackingConfig } from "../tracking/types";
import { analyzeResponse, ANALYSIS_MODEL, summarizePerception } from "./analyze";
import { CHATGPT_MODELS, CLAUDE_MODELS, analysisCost, typicalAnswerCost } from "./pricing";
import { askAiMode, askAiOverview, askChatGpt, askClaude, mockAnswer, platformMock, type Answer } from "./providers";
import { BudgetExceeded, ensureBudget, recordSpend } from "./spend";
import { listCycles, readCycle, readPrompts, readSettings, updateCycleSummary, writeCycle, writeCycles } from "./store";
import { PLATFORMS, PLATFORM_LABEL, type BrandResponse, type BrandSettings, type Cycle, type CycleSummary, type Platform } from "./types";

const CONCURRENCY = 6;
const LOCK_MS = 5 * 60_000;
const WEEK_MS = 7 * 24 * 3600_000;
/** Stop starting new answers after this long, so the function finishes inside Vercel's 300 s limit. */
const DEFAULT_TIME_BUDGET_MS = 230_000;

export interface RunOutcome {
  cycle: CycleSummary | null;
  ran: number;
  stoppedBy?: "budget" | "time" | "locked" | "no-prompts" | "not-due";
  message?: string;
}

function modelFor(settings: BrandSettings, platform: Platform): string | undefined {
  if (platform === "chatgpt") return settings.chatgptModel;
  if (platform === "claude") return settings.claudeModel;
  return undefined;
}

/** What an answer is expected to cost before it runs (for the daily cap). */
function expectedCost(settings: BrandSettings, platform: Platform): number {
  const analysis = analysisCost(ANALYSIS_MODEL);
  if (platformMock(platform)) return 0;
  if (platform === "chatgpt") {
    const m = CHATGPT_MODELS.find((x) => x.id === settings.chatgptModel) ?? CHATGPT_MODELS[0];
    return typicalAnswerCost(m) + analysis;
  }
  if (platform === "claude") {
    const m = CLAUDE_MODELS.find((x) => x.id === settings.claudeModel) ?? CLAUDE_MODELS[0];
    return typicalAnswerCost(m) + analysis;
  }
  return analysis;
}

async function answer(platform: Platform, prompt: string, config: TrackingConfig, settings: BrandSettings): Promise<Answer> {
  if (platformMock(platform)) return mockAnswer(platform, prompt, config.brand.name || "Your brand", config.competitors.map((c) => c.name));
  switch (platform) {
    case "aiMode":
      return askAiMode(prompt, config.settings);
    case "aiOverview":
      return askAiOverview(prompt, config.settings);
    case "chatgpt":
      return askChatGpt(prompt, config.settings, settings.chatgptModel);
    case "claude":
      return askClaude(prompt, config.settings, settings.claudeModel);
  }
}

function newCycleId(): string {
  return `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 6)}`;
}

/** Starts a cycle: every active prompt on every enabled platform. */
async function startCycle(projectId: string, trigger: CycleSummary["trigger"]): Promise<{ summary: CycleSummary; cycle: Cycle } | null> {
  const [prompts, settings] = await Promise.all([readPrompts(projectId), readSettings(projectId)]);
  const active = prompts.filter((p) => p.active);
  const platforms = PLATFORMS.filter((p) => settings.platforms[p]);
  if (active.length === 0 || platforms.length === 0) return null;
  const id = newCycleId();
  const cycle: Cycle = {
    id,
    plan: active.flatMap((p) => platforms.map((platform) => ({ promptId: p.id, platform }))),
    prompts: Object.fromEntries(active.map((p) => [p.id, { text: p.text, topic: p.topic, branded: p.branded }])),
    responses: [],
    summaries: {},
    attributes: [],
  };
  // Carry the attribute names forward so attributes stay comparable from cycle to cycle.
  const previous = (await listCycles(projectId)).at(-1);
  if (previous) cycle.attributes = (await readCycle(projectId, previous.id))?.attributes ?? [];
  const summary: CycleSummary = { id, startedAt: new Date().toISOString(), status: "running", total: cycle.plan.length, done: 0, costUsd: 0, serpCredits: 0, trigger };
  await writeCycle(projectId, cycle);
  await writeCycles(projectId, [...(await listCycles(projectId)), summary]);
  return { summary, cycle };
}

/**
 * Works through a project's current cycle (or starts one) until it's finished, the time budget runs out, or the
 * daily AI spending cap is reached. Progress is saved as it goes, so the next call simply carries on.
 */
export async function runBrandProject(
  projectId: string,
  options: { start: "always" | "if-due" | "never"; trigger: CycleSummary["trigger"]; timeBudgetMs?: number }
): Promise<RunOutcome> {
  const deadline = Date.now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const cycles = await listCycles(projectId);
  let summary = [...cycles].reverse().find((c) => c.status !== "done") ?? null;
  let cycle: Cycle | null = summary ? await readCycle(projectId, summary.id) : null;

  if (!summary || !cycle) {
    const last = cycles.at(-1);
    const due = !last || Date.now() - new Date(last.startedAt).getTime() >= WEEK_MS - 3600_000;
    if (options.start === "never" || (options.start === "if-due" && !due)) return { cycle: last ?? null, ran: 0, stoppedBy: "not-due" };
    const started = await startCycle(projectId, options.trigger);
    if (!started) return { cycle: null, ran: 0, stoppedBy: "no-prompts", message: "Add at least one active prompt and enable a platform first." };
    ({ summary, cycle } = started);
  }

  if (summary.lockUntil && new Date(summary.lockUntil).getTime() > Date.now()) {
    return { cycle: summary, ran: 0, stoppedBy: "locked", message: "A run for this project is already in progress." };
  }
  summary = (await updateCycleSummary(projectId, summary.id, { lockUntil: new Date(Date.now() + LOCK_MS).toISOString(), status: "running", note: undefined })) ?? summary;

  const [config, settings] = await Promise.all([readConfig(projectId), readSettings(projectId)]);
  const doneKeys = new Set(cycle.responses.map((r) => `${r.promptId}:${r.platform}`));
  const pending = cycle.plan.filter((t) => !doneKeys.has(`${t.promptId}:${t.platform}`));
  let ran = 0;
  let stoppedBy: RunOutcome["stoppedBy"];
  let budgetMessage: string | undefined;
  let unsaved = 0;
  const working = cycle;

  const save = async () => {
    unsaved = 0;
    const costUsd = working.responses.reduce((s, r) => s + r.costUsd, 0);
    const serpCredits = working.responses.reduce((s, r) => s + r.serpCredits, 0);
    await writeCycle(projectId, working);
    summary = (await updateCycleSummary(projectId, working.id, { done: working.responses.length, costUsd, serpCredits })) ?? summary;
  };

  let next = 0;
  const worker = async () => {
    while (next < pending.length && !stoppedBy) {
      if (Date.now() > deadline) {
        stoppedBy = "time";
        return;
      }
      const task = pending[next++];
      const prompt = working.prompts[task.promptId];
      if (!prompt) continue;
      try {
        await ensureBudget(expectedCost(settings, task.platform));
      } catch (err) {
        if (err instanceof BudgetExceeded) {
          stoppedBy = "budget";
          budgetMessage = err.message;
          return;
        }
        throw err;
      }
      const response: BrandResponse = {
        promptId: task.promptId,
        platform: task.platform,
        at: new Date().toISOString(),
        present: false,
        text: "",
        sources: [],
        costUsd: 0,
        serpCredits: 0,
        model: modelFor(settings, task.platform),
      };
      try {
        const a = await answer(task.platform, prompt.text, config, settings);
        Object.assign(response, { present: a.present, text: a.text, sources: a.sources, costUsd: a.costUsd, serpCredits: a.serpCredits, model: a.model ?? response.model });
        if (a.provider) await recordSpend(a.provider, a.costUsd);
        if (a.present) {
          const { analysis, costUsd } = await analyzeResponse(a, prompt.text, config.brand, config.competitors, working.attributes);
          response.analysis = analysis;
          response.costUsd += costUsd;
          await recordSpend("openai", costUsd);
          for (const name of [...analysis.claims.map((c) => c.attribute), ...analysis.brands.flatMap((b) => b.attributes.map((x) => x.attribute))]) {
            if (name && !working.attributes.includes(name) && working.attributes.length < 40) working.attributes.push(name);
          }
        }
      } catch (err) {
        const e = err as Error & { costUsd?: number };
        response.error = e.message?.slice(0, 300) || "Failed";
        if (e.costUsd) {
          response.costUsd += e.costUsd;
          await recordSpend("anthropic", e.costUsd);
        }
      }
      working.responses.push(response);
      ran++;
      if (++unsaved >= CONCURRENCY) await save();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pending.length)) }, worker));
  await save();

  const finished = working.responses.length >= working.plan.length;
  if (finished && !stoppedBy) {
    try {
      await buildSummaries(working, config, settings);
      await writeCycle(projectId, working);
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      stoppedBy = "budget";
      budgetMessage = err.message;
    }
  }
  const status: CycleSummary["status"] = finished && !stoppedBy ? "done" : stoppedBy === "budget" ? "paused-budget" : "running";
  summary =
    (await updateCycleSummary(projectId, working.id, {
      status,
      lockUntil: undefined,
      ...(status === "done" ? { finishedAt: new Date().toISOString() } : {}),
      note: stoppedBy === "budget" ? budgetMessage : stoppedBy === "time" ? "Continues automatically on the next run." : undefined,
    })) ?? summary;
  return { cycle: summary, ran, stoppedBy, message: budgetMessage };
}

/** Perception narratives for the whole cycle and for each platform. */
export async function buildSummaries(cycle: Cycle, config: TrackingConfig, settings: BrandSettings): Promise<void> {
  const scopes: Array<Platform | "all"> = ["all", ...PLATFORMS.filter((p) => settings.platforms[p])];
  for (const scope of scopes) {
    const claims = cycle.responses
      .filter((r) => (scope === "all" || r.platform === scope) && r.analysis?.brandMentioned)
      .flatMap((r) => (r.analysis?.claims ?? []).map((c) => ({ ...c, platform: r.platform })));
    await ensureBudget(0.002);
    const { summary, costUsd } = await summarizePerception(config.brand, claims, scope === "all" ? "AI answer engines" : PLATFORM_LABEL[scope]);
    await recordSpend("openai", costUsd);
    cycle.summaries[scope] = summary;
  }
}

/** Daily cron: continue unfinished cycles and start weekly ones that are due, project by project. */
export async function runScheduled(): Promise<Array<{ projectId: string } & RunOutcome>> {
  const deadline = Date.now() + DEFAULT_TIME_BUDGET_MS;
  const results: Array<{ projectId: string } & RunOutcome> = [];
  for (const projectId of await listProjectIds()) {
    const remaining = deadline - Date.now();
    if (remaining < 20_000) break;
    const settings = await readSettings(projectId);
    const outcome = await runBrandProject(projectId, {
      start: settings.schedule === "weekly" ? "if-due" : "never",
      trigger: "schedule",
      timeBudgetMs: remaining,
    });
    results.push({ projectId, ...outcome });
    if (outcome.stoppedBy === "budget") break;
  }
  return results;
}
