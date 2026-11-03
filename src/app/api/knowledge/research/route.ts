import type { NextRequest } from "next/server";
import { BudgetExceeded } from "@/lib/brand/spend";
import { ResearchInputError, runResearchStep } from "@/lib/knowledge/research";
import { RESEARCH_STEPS, type ResearchStep } from "@/lib/knowledge/types";
import { readConfig, resolveProject } from "@/lib/tracking/store";

export const maxDuration = 120;

/** Runs one research step (site, serp, profile, demand) and returns the updated knowledge base. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; step?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const step = body?.step as ResearchStep;
  if (!RESEARCH_STEPS.includes(step)) return Response.json({ error: "Unknown step" }, { status: 400 });
  try {
    const kb = await runResearchStep(projectId, await readConfig(projectId), step);
    return Response.json({ kb });
  } catch (err) {
    const status = err instanceof ResearchInputError ? 400 : err instanceof BudgetExceeded ? 429 : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Research failed" }, { status });
  }
}
