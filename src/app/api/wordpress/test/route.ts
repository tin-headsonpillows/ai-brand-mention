import type { NextRequest } from "next/server";
import { testConnection } from "@/lib/wordpress/client";
import { readCredentials, readSettings, saveTest } from "@/lib/wordpress/store";
import { resolveProject } from "@/lib/tracking/store";

/** Logs in to the project's WordPress and reports what it can do. */
export async function POST(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const credentials = await readCredentials(projectId);
  if (!credentials) return Response.json({ error: "Save the WordPress connection first" }, { status: 400 });
  const test = await testConnection(credentials);
  await saveTest(projectId, test);
  return Response.json({ test, settings: await readSettings(projectId) });
}
