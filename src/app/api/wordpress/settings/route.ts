import type { NextRequest } from "next/server";
import { deleteSettings, readSettings, saveSettings, type SeoPlugin } from "@/lib/wordpress/store";
import { resolveProject } from "@/lib/tracking/store";

const PLUGINS: SeoPlugin[] = ["yoast", "rankmath", "none"];

/** The project's WordPress connection (the application password is never returned). */
export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  return Response.json({ settings: await readSettings(projectId) });
}

export async function PUT(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const siteUrl = typeof b.siteUrl === "string" ? b.siteUrl : "";
  const username = typeof b.username === "string" ? b.username : "";
  if (!siteUrl.trim() || !username.trim()) return Response.json({ error: "Site address and username are required" }, { status: 400 });
  const current = await readSettings(projectId);
  const password = typeof b.password === "string" ? b.password : "";
  if (!password.trim() && !current?.hasPassword) return Response.json({ error: "Add an application password" }, { status: 400 });
  try {
    const settings = await saveSettings(projectId, {
      siteUrl,
      username,
      password,
      seoPlugin: PLUGINS.includes(b.seoPlugin as SeoPlugin) ? (b.seoPlugin as SeoPlugin) : "none",
    });
    return Response.json({ settings });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't save" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  await deleteSettings(projectId);
  return Response.json({ ok: true });
}
