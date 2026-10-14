import type { NextRequest } from "next/server";
import { listSites, readSnapshot, resolveSite, writeSnapshot } from "@/lib/seranking/store";
import { syncSite } from "@/lib/seranking/sync";
import { listProjectIds, resolveProject } from "@/lib/tracking/store";

export const maxDuration = 300;

/** Snapshots newer than this are left alone by the daily cron (SE Ranking checks rankings once a day). */
const FRESH_MS = 20 * 3_600_000;
const TIME_BUDGET_MS = 240_000;

/** Cron calls carry Authorization: Bearer <CRON_SECRET>; UI calls carry none (the deployment is access-controlled). */
function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return true;
  const cronSecret = process.env.CRON_SECRET;
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

/** With ?project: sync that project now. Without: the daily cron - sync every linked project that isn't fresh. */
async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const requested = req.nextUrl.searchParams.get("project");
    if (requested) {
      const projectId = await resolveProject(requested);
      if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
      const { site } = await resolveSite(projectId);
      if (!site) return Response.json({ error: "Link this project to an SE Ranking project first." }, { status: 400 });
      const snapshot = await syncSite(site);
      await writeSnapshot(projectId, snapshot);
      return Response.json({ ok: true, syncedAt: snapshot.syncedAt, errors: snapshot.errors });
    }

    const started = Date.now();
    const sites = await listSites(true);
    const results: Array<{ projectId: string; siteId?: number; status: string }> = [];
    for (const projectId of await listProjectIds()) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        results.push({ projectId, status: "skipped: out of time" });
        continue;
      }
      const { site } = await resolveSite(projectId, sites);
      if (!site) {
        results.push({ projectId, status: "no SE Ranking project" });
        continue;
      }
      const last = await readSnapshot(projectId);
      if (last && last.siteId === site.id && Date.now() - Date.parse(last.syncedAt) < FRESH_MS) {
        results.push({ projectId, siteId: site.id, status: "fresh" });
        continue;
      }
      try {
        await writeSnapshot(projectId, await syncSite(site));
        results.push({ projectId, siteId: site.id, status: "synced" });
      } catch (err) {
        results.push({ projectId, siteId: site.id, status: `failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    return Response.json({ projects: results });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "SE Ranking sync failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
