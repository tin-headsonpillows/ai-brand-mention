import type { NextRequest } from "next/server";
import { setFact } from "@/lib/brand/store";
import type { FactVerdict } from "@/lib/brand/types";
import { resolveProject } from "@/lib/tracking/store";

/** Marks an AI-stated fact about the brand as correct or incorrect (null clears it). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; key?: unknown; verdict?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const key = typeof body?.key === "string" ? body.key.slice(0, 200) : "";
  if (!key) return Response.json({ error: "Missing fact" }, { status: 400 });
  const verdict = body?.verdict === "correct" || body?.verdict === "incorrect" ? (body.verdict as FactVerdict) : null;
  return Response.json({ verdicts: await setFact(projectId, key, verdict) });
}
