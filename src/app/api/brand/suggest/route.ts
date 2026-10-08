import type { NextRequest } from "next/server";
import { suggestPrompts } from "@/lib/brand/analyze";
import { BudgetExceeded, ensureBudget, recordSpend } from "@/lib/brand/spend";
import { suggestContext } from "@/lib/brand/customers";
import { readPrompts, readSettings } from "@/lib/brand/store";
import { readConfig, resolveProject } from "@/lib/tracking/store";

export const maxDuration = 60;

/**
 * ChatGPT-suggested decision-making prompts (comparisons, worth it, reviews, best for, right fit, who it suits) from the
 * brand, its competitors, the tracked keywords and what its review listings say (category, location, audiences).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; count?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const [config, existing, settings] = await Promise.all([readConfig(projectId), readPrompts(projectId), readSettings(projectId)]);
  if (!config.brand.name) return Response.json({ error: "Set the brand name in Settings first" }, { status: 400 });
  const count = Math.max(5, Math.min(40, Math.round(Number(body?.count) || 20)));
  try {
    await ensureBudget(0.01);
    const context = await suggestContext(projectId, config, settings).catch(() => undefined);
    const { prompts, costUsd } = await suggestPrompts(
      config.brand,
      config.competitors,
      config.keywords.map((k) => k.keyword),
      existing.map((p) => p.text),
      count,
      `${config.settings.country.toUpperCase()} / ${config.settings.language}`,
      context
    );
    await recordSpend("openai", costUsd);
    return Response.json({ prompts });
  } catch (err) {
    const status = err instanceof BudgetExceeded ? 429 : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Suggestions failed" }, { status });
  }
}
