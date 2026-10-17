import type { NextRequest } from "next/server";
import { ContentError, createDocs, MAX_DOCS_PER_CALL } from "@/lib/content/service";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 300;

/** Creates Google Docs (in the project's Drive folder) for the given cards and links them in the plan. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; keys?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const keys = Array.isArray(body?.keys) ? body.keys.filter((k): k is string => typeof k === "string").slice(0, MAX_DOCS_PER_CALL) : [];
  if (!keys.length) return Response.json({ error: "Pick the articles to create Docs for." }, { status: 400 });
  try {
    return Response.json(await createDocs(projectId, keys));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't create Docs" }, { status: err instanceof ContentError ? err.status : 400 });
  }
}
