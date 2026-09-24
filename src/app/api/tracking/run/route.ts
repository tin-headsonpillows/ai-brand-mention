import type { NextRequest } from "next/server";
import { runAllProjects, runProject } from "@/lib/tracking/runAll";
import { resolveProject } from "@/lib/tracking/store";

export const maxDuration = 300;

/**
 * Triggered by Vercel Cron (with an Authorization: Bearer <CRON_SECRET> header) once a day to track
 * every project, and by the UI's "Run now" button with ?project=<id> to track just that one. Manual
 * calls have no Authorization header and are trusted because the whole deployment already sits
 * behind Vercel Authentication.
 */
function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return true;
  const cronSecret = process.env.CRON_SECRET;
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const requested = req.nextUrl.searchParams.get("project");
    if (!requested) return Response.json({ projects: await runAllProjects() });
    const projectId = await resolveProject(requested);
    if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
    return Response.json(await runProject(projectId));
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
