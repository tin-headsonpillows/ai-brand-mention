import type { NextRequest } from "next/server";
import { BudgetExceeded } from "@/lib/brand/spend";
import { KeywordInputError, runKeywordStep } from "@/lib/keywords/research";
import { KEYWORD_STEPS, type KeywordStep } from "@/lib/keywords/types";
import { readConfig, resolveProject } from "@/lib/tracking/store";

export const maxDuration = 120;

/**
 * One keyword-research step: taxonomy, volume (SE Ranking, or an uploaded CSV/TSV in `csv`), serp (a batch of live
 * Google checks; call again while `remaining` > 0) and finish (intent, clusters, target pages, priority).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; step?: unknown; csv?: unknown; csvName?: unknown; maxSerp?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const step = body?.step as KeywordStep;
  if (!KEYWORD_STEPS.includes(step)) return Response.json({ error: "Unknown step" }, { status: 400 });
  const csv = typeof body?.csv === "string" ? body.csv.slice(0, 2_000_000) : undefined;
  try {
    const out = await runKeywordStep(projectId, await readConfig(projectId), step, {
      csv,
      csvName: typeof body?.csvName === "string" ? body.csvName.slice(0, 120) : undefined,
      maxSerp: typeof body?.maxSerp === "number" ? body.maxSerp : undefined,
    });
    return Response.json(out);
  } catch (err) {
    const status = err instanceof KeywordInputError ? 400 : err instanceof BudgetExceeded ? 429 : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Keyword research failed" }, { status });
  }
}
