import type { NextRequest } from "next/server";
import { readResearch } from "@/lib/keywords/store";
import { kwSerpIsMock } from "@/lib/keywords/serp";
import { volumeIsMock } from "@/lib/keywords/volume";
import { readKnowledgeBase } from "@/lib/knowledge/store";
import { isMockMode } from "@/lib/openai";
import { readConfig, resolveProject } from "@/lib/tracking/store";

/** The project's keyword research, plus which sources are live (OpenAI, SerpApi, SE Ranking). */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const [research, kb, config] = await Promise.all([readResearch(projectId), readKnowledgeBase(projectId), readConfig(projectId)]);
  return Response.json({
    research,
    project: { brand: config.brand, settings: config.settings },
    hasKnowledgeBase: !!kb.profile,
    live: { openai: !isMockMode(), serp: !kwSerpIsMock(), seRanking: !volumeIsMock() },
  });
}
