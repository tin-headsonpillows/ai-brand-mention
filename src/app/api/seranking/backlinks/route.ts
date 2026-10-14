import type { NextRequest } from "next/server";
import { readSnapshot, resolveSite, writeSnapshot } from "@/lib/seranking/store";
import { linkProfileFor } from "@/lib/seranking/sync";
import type { SeSnapshot } from "@/lib/seranking/types";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 120;

/** Refreshes only the backlink profile of the project's snapshot (SE Ranking Data API - costs API credits). */
export async function POST(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  try {
    const [{ site }, snapshot] = await Promise.all([resolveSite(projectId), readSnapshot(projectId)]);
    if (!site) return Response.json({ error: "Link this project to an SE Ranking project first." }, { status: 400 });
    if (!snapshot || snapshot.siteId !== site.id) return Response.json({ error: "Sync this project first." }, { status: 400 });
    const errors: SeSnapshot["errors"] = { ...snapshot.errors };
    delete errors.linkProfile;
    const linkProfile = await linkProfileFor(site, snapshot.competitors, new Date(), { previous: snapshot, refreshLinks: true }, errors);
    await writeSnapshot(projectId, { ...snapshot, linkProfile, errors });
    return Response.json({ ok: !errors.linkProfile, error: errors.linkProfile ?? null, partial: linkProfile?.errors ?? {} });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't refresh backlinks" }, { status: 502 });
  }
}
