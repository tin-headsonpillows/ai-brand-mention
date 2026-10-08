import type { NextRequest } from "next/server";
import { deleteCycle, listCycles, readCycle } from "@/lib/brand/store";
import { resolveProject } from "@/lib/tracking/store";

/** One cycle's full answers (for the responses explorer). */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const id = req.nextUrl.searchParams.get("id") ?? (await listCycles(projectId)).at(-1)?.id ?? "";
  const cycle = await readCycle(projectId, id);
  return cycle ? Response.json({ cycle }) : Response.json({ error: "No answers yet" }, { status: 404 });
}

export async function DELETE(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  const id = req.nextUrl.searchParams.get("id");
  if (!projectId || !id) return Response.json({ error: "Missing project or cycle" }, { status: 400 });
  await deleteCycle(projectId, id);
  return Response.json({ ok: true });
}
