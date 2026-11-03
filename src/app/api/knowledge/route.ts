import type { NextRequest } from "next/server";
import { readKnowledgeBase } from "@/lib/knowledge/store";
import { serpIsMock } from "@/lib/knowledge/serp";
import { isMockMode } from "@/lib/openai";
import { readConfig, resolveProject } from "@/lib/tracking/store";

/** The project's brand knowledge base, plus which data sources are live or simulated. */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const [kb, config] = await Promise.all([readKnowledgeBase(projectId), readConfig(projectId)]);
  return Response.json({
    kb,
    project: { brand: config.brand, competitors: config.competitors, settings: config.settings },
    mock: { openai: isMockMode(), serp: serpIsMock() },
  });
}
