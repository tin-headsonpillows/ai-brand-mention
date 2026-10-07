import type { NextRequest } from "next/server";
import { listCategories } from "@/lib/wordpress/client";
import { readCredentials } from "@/lib/wordpress/store";
import { resolveProject } from "@/lib/tracking/store";

/** The site's categories, for the publish panel's picker. */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const credentials = await readCredentials(projectId);
  if (!credentials) return Response.json({ categories: [] });
  try {
    return Response.json({ categories: await listCategories(credentials) });
  } catch (err) {
    return Response.json({ categories: [], error: err instanceof Error ? err.message : "Couldn't load categories" });
  }
}
