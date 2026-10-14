import type { NextRequest } from "next/server";
import { writeLink } from "@/lib/seranking/store";
import { resolveProject } from "@/lib/tracking/store";

/** Choose which SE Ranking project an app project shows (null = match the brand's website automatically). */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; siteId?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const siteId = typeof body?.siteId === "number" && Number.isInteger(body.siteId) && body.siteId > 0 ? body.siteId : null;
  await writeLink(projectId, { siteId });
  return Response.json({ ok: true, siteId });
}
