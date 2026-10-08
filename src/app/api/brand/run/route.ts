import type { NextRequest } from "next/server";
import { runBrandProject, runScheduled } from "@/lib/brand/run";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 300;

/** Cron calls carry Authorization: Bearer <CRON_SECRET>; UI calls carry none (the deployment is access-controlled). */
function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return true;
  const cronSecret = process.env.CRON_SECRET;
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

/**
 * With ?project: run that project now (continue its unfinished cycle, or start a new one).
 * Without: the daily cron - continue unfinished cycles and start weekly ones that are due.
 */
async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const requested = req.nextUrl.searchParams.get("project");
    if (!requested) return Response.json({ projects: await runScheduled() });
    const projectId = await resolveProject(requested);
    if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
    return Response.json(await runBrandProject(projectId, { start: "always", trigger: "manual" }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
