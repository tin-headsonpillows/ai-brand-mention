import { ANALYSIS_MODEL } from "./analyze";
import { CHATGPT_MODELS, CLAUDE_MODELS, SERP_CREDITS, analysisCost, typicalAnswerCost } from "./pricing";
import { platformMock } from "./providers";
import { dailyLimit, recentSpend, spentToday, type DaySpend } from "./spend";
import { listCycles, readCycle } from "./store";
import { PLATFORMS, type BrandSettings, type Platform } from "./types";

export interface CostReport {
  promptCount: number;
  platforms: Platform[];
  perRun: { chatgpt: number; claude: number; analysis: number; total: number; serpCredits: number };
  perWeek: number;
  perMonth: number;
  basis: { chatgpt: "observed" | "estimate"; claude: "observed" | "estimate" };
  /** Projected cost of one answer for each selectable model, for the model pickers. */
  models: Array<{ id: string; label: string; provider: "openai" | "anthropic"; note: string; perAnswer: number; perRun: number; perMonth: number }>;
  today: DaySpend;
  limit: number;
  recent: DaySpend[];
  /** How many runs today's remaining budget covers. */
  runsLeftToday: number | null;
  mock: Record<Platform, boolean>;
}

const RUNS_PER_MONTH = 52 / 12;

/**
 * Projected cost per run / week / month from the active prompts and enabled platforms. Uses the average real
 * cost per answer from the latest finished cycle when it used the same model, otherwise typical token counts.
 */
export async function costReport(projectId: string, settings: BrandSettings, promptCount: number): Promise<CostReport> {
  const platforms = PLATFORMS.filter((p) => settings.platforms[p]);
  const last = [...(await listCycles(projectId))].reverse().find((c) => c.status === "done");
  const lastCycle = last ? await readCycle(projectId, last.id) : null;
  const analysis = analysisCost(ANALYSIS_MODEL);

  const observed = (platform: Platform, model: string): number | null => {
    const rows = (lastCycle?.responses ?? []).filter((r) => r.platform === platform && r.costUsd > 0 && r.model && (r.model === model || r.model.startsWith(model)));
    return rows.length >= 3 ? rows.reduce((s, r) => s + r.costUsd, 0) / rows.length : null;
  };
  const chatgptModel = CHATGPT_MODELS.find((m) => m.id === settings.chatgptModel) ?? CHATGPT_MODELS[0];
  const claudeModel = CLAUDE_MODELS.find((m) => m.id === settings.claudeModel) ?? CLAUDE_MODELS[0];
  const chatgptObserved = observed("chatgpt", chatgptModel.id);
  const claudeObserved = observed("claude", claudeModel.id);
  // Observed costs already include the analysis of that answer.
  const chatgptPer = chatgptObserved ?? typicalAnswerCost(chatgptModel) + analysis;
  const claudePer = claudeObserved ?? typicalAnswerCost(claudeModel) + analysis;

  const chatgpt = settings.platforms.chatgpt ? promptCount * (chatgptObserved !== null ? chatgptPer : typicalAnswerCost(chatgptModel)) : 0;
  const claude = settings.platforms.claude ? promptCount * (claudeObserved !== null ? claudePer : typicalAnswerCost(claudeModel)) : 0;
  const analysisTotal =
    promptCount * analysis * platforms.filter((p) => (p === "chatgpt" ? chatgptObserved === null : p === "claude" ? claudeObserved === null : true)).length;
  const total = chatgpt + claude + analysisTotal;
  const serpCredits = promptCount * platforms.reduce((s, p) => s + SERP_CREDITS[p], 0);

  const [today, limit, recent] = await Promise.all([spentToday(), dailyLimit(), recentSpend(14)]);
  const models = [...CHATGPT_MODELS, ...CLAUDE_MODELS].map((m) => {
    const perAnswer = typicalAnswerCost(m) + analysis;
    return { id: m.id, label: m.label, provider: m.provider, note: m.note, perAnswer, perRun: perAnswer * promptCount, perMonth: perAnswer * promptCount * RUNS_PER_MONTH };
  });
  return {
    promptCount,
    platforms,
    perRun: { chatgpt, claude, analysis: analysisTotal, total, serpCredits },
    perWeek: total,
    perMonth: total * RUNS_PER_MONTH,
    basis: { chatgpt: chatgptObserved !== null ? "observed" : "estimate", claude: claudeObserved !== null ? "observed" : "estimate" },
    models,
    today,
    limit,
    recent,
    runsLeftToday: total > 0 ? Math.max(0, (limit - today.totalUsd) / total) : null,
    mock: Object.fromEntries(PLATFORMS.map((p) => [p, platformMock(p)])) as Record<Platform, boolean>,
  };
}
