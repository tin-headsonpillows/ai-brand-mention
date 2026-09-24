import type { NextRequest } from "next/server";
import { runAllKeywords } from "@/lib/tracking/runAll";

export const maxDuration = 300;

/**
 * Triggered by Vercel Cron (with an Authorization: Bearer <CRON_SECRET> header) once a day,
 * and also callable manually from the UI's "Run now" button. Manual calls have no Authorization
 * header and are trusted because the whole deployment already sits behind Vercel Authentication.
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
    const result = await runAllKeywords();
    return Response.json(result);
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
