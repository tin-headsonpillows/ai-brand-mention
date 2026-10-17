import type { NextRequest } from "next/server";
import { ContentError, syncBoard } from "@/lib/content/service";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 60;

/** Re-reads the project's content plan and rebuilds its board. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  try {
    return Response.json({ board: await syncBoard(projectId) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: err instanceof ContentError ? err.status : 400 });
  }
}
