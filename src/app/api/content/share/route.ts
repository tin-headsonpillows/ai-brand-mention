import type { NextRequest } from "next/server";
import { ContentError, shareItem } from "@/lib/content/service";
import { resolveProject } from "@/lib/tracking/store";
import { authorize } from "@/lib/access/store";

export const maxDuration = 60;

/** Gives the client (the project's client emails, or the ones sent) comment access to a card's Doc. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown; key?: unknown; emails?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const auth = await authorize(projectId, "editor");
  if (!auth.ok) return auth.response;
  const emails = Array.isArray(body?.emails) ? body.emails.filter((e): e is string => typeof e === "string").map((e) => e.trim()).slice(0, 20) : undefined;
  try {
    return Response.json(await shareItem(projectId, typeof body?.key === "string" ? body.key : "", emails));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't share" }, { status: err instanceof ContentError ? err.status : 400 });
  }
}
