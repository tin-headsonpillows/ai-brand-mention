import { gzipSync } from "zlib";
import type { NextRequest } from "next/server";
import { isSeRankingMock } from "@/lib/seranking/client";
import { readSnapshot, resolveSite } from "@/lib/seranking/store";
import { resolveProject } from "@/lib/tracking/store";

/** The SE Ranking project linked to an app project and its last synced snapshot (gzipped - keyword history adds up). */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  let linked: Awaited<ReturnType<typeof resolveSite>> = { site: null, auto: true };
  let siteError: string | null = null;
  try {
    linked = await resolveSite(projectId);
  } catch (err) {
    siteError = err instanceof Error ? err.message : "Couldn't load SE Ranking projects";
  }
  const snapshot = await readSnapshot(projectId);
  const body = JSON.stringify({
    mock: isSeRankingMock(),
    site: linked.site,
    auto: linked.auto,
    siteError,
    // A snapshot of a different SE Ranking project (the link changed) is not shown.
    snapshot: snapshot && linked.site && snapshot.siteId === linked.site.id ? snapshot : null,
  });
  return new Response(gzipSync(body), { headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "no-store" } });
}
