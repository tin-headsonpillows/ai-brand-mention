import type { NextRequest } from "next/server";
import { buildDashboard, type DashboardFilters } from "@/lib/brand/dashboard";
import { costReport } from "@/lib/brand/costs";
import { listCycles, readCycle, readFacts, readPrompts, readSettings } from "@/lib/brand/store";
import { PLATFORMS, type Cycle, type Platform } from "@/lib/brand/types";
import { readConfig, resolveProject } from "@/lib/tracking/store";

const RANGES: Record<string, number | null> = { "30": 30, "90": 90, "180": 180, "365": 365, all: null };

/** Everything the Brand Mentions dashboard shows, aggregated for the chosen date range and filters. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const projectId = await resolveProject(p.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const filters: DashboardFilters = {
    platform: PLATFORMS.includes(p.get("platform") as Platform) ? (p.get("platform") as Platform) : "all",
    promptType: p.get("type") === "branded" || p.get("type") === "unbranded" ? (p.get("type") as "branded" | "unbranded") : "all",
    topic: p.get("topic") || "all",
  };
  const days = RANGES[p.get("range") ?? "90"] ?? (p.get("range") === "all" ? null : 90);
  const since = days ? new Date(Date.now() - days * 86400_000).toISOString() : null;

  const [summaries, config, settings, prompts, verdicts] = await Promise.all([
    listCycles(projectId),
    readConfig(projectId),
    readSettings(projectId),
    readPrompts(projectId),
    readFacts(projectId),
  ]);
  const inRange = summaries.filter((c) => !since || c.startedAt >= since).slice(-26);
  const cycles = (await Promise.all(inRange.map((c) => readCycle(projectId, c.id)))).filter((c): c is Cycle => c !== null);
  const dashboard = buildDashboard(inRange, cycles, config, filters, verdicts);
  const costs = await costReport(projectId, settings, prompts.filter((x) => x.active).length);
  const body = JSON.stringify({
    dashboard,
    settings,
    costs,
    brand: config.brand,
    competitors: config.competitors.map((c) => ({ name: c.name, website: c.website })),
    allCycles: summaries.map(({ id, startedAt, status, done, total, costUsd, serpCredits, note, finishedAt }) => ({ id, startedAt, status, done, total, costUsd, serpCredits, note, finishedAt })),
  });
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
