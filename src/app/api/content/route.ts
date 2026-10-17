import type { NextRequest } from "next/server";
import { readBoard, readPlanConfig } from "@/lib/content/store";
import { resolveProject } from "@/lib/tracking/store";
import { authorize } from "@/lib/access/store";

/** The project's content plan settings and board (as of the last sync). */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const auth = await authorize(projectId, "viewer");
  if (!auth.ok) return auth.response;
  const [config, board] = await Promise.all([readPlanConfig(projectId), readBoard(projectId)]);
  return Response.json({ config, board });
}
