import type { NextRequest } from "next/server";
import { createProject, defaultConfig, deleteProject, listProjectIds, readConfig, resolveProject } from "@/lib/tracking/store";
import type { ProjectSummary } from "@/lib/tracking/types";

export async function GET() {
  const ids = await listProjectIds();
  const projects: ProjectSummary[] = await Promise.all(
    ids.map(async (id) => {
      const config = await readConfig(id);
      return {
        id,
        name: config.brand.name || config.brand.website || "Untitled project",
        website: config.brand.website,
        settings: config.settings,
        keywordCount: config.keywords.length,
      };
    })
  );
  return Response.json({ projects });
}

/** Creates a project for a new brand/site, starting from the default search settings unless overridden. */
export async function POST(req: NextRequest) {
  let body: { name?: unknown; website?: unknown; language?: unknown; country?: unknown; device?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const website = typeof body.website === "string" ? body.website.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : "";
  if (!name && !website) return Response.json({ error: "A brand name or website is required" }, { status: 400 });

  const config = defaultConfig();
  config.brand = { name, aliases: [], website };
  if (typeof body.language === "string" && body.language.trim()) config.settings.language = body.language.trim();
  if (typeof body.country === "string" && body.country.trim()) config.settings.country = body.country.trim();
  if (body.device === "desktop" || body.device === "tablet" || body.device === "mobile") config.settings.device = body.device;

  const id = await createProject(config);
  return Response.json({ id });
}

export async function DELETE(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  try {
    await deleteProject(projectId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to delete project" }, { status: 400 });
  }
}
