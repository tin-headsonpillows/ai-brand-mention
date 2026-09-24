import type { NextRequest } from "next/server";
import { readConfig, resolveProject, writeConfig } from "@/lib/tracking/store";
import { RESULT_DEPTHS, type ResultDepth, type TrackedCompetitor, type TrackingConfig } from "@/lib/tracking/types";

export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  return Response.json(await readConfig(projectId));
}

function isValidDevice(v: unknown): v is TrackingConfig["settings"]["device"] {
  return v === "desktop" || v === "tablet" || v === "mobile";
}

export async function PUT(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = body as Partial<TrackingConfig>;
  const current = await readConfig(projectId);

  const settings = input.settings
    ? {
        language: String(input.settings.language || current.settings.language).trim() || "en",
        country: String(input.settings.country || current.settings.country).trim() || "us",
        device: isValidDevice(input.settings.device) ? input.settings.device : current.settings.device,
        resultDepth: RESULT_DEPTHS.includes(Number(input.settings.resultDepth) as ResultDepth)
          ? (Number(input.settings.resultDepth) as ResultDepth)
          : current.settings.resultDepth,
      }
    : current.settings;

  const brand = input.brand
    ? {
        name: String(input.brand.name ?? current.brand.name).trim(),
        aliases: Array.isArray(input.brand.aliases)
          ? input.brand.aliases.map((a) => String(a).trim()).filter(Boolean)
          : current.brand.aliases,
        website: String(input.brand.website ?? current.brand.website).trim(),
      }
    : current.brand;

  const keywords = Array.isArray(input.keywords) ? input.keywords : current.keywords;

  const competitors: TrackedCompetitor[] = Array.isArray(input.competitors)
    ? input.competitors.map((c) => ({
        id: String(c?.id || crypto.randomUUID()),
        name: String(c?.name ?? "").trim(),
        aliases: Array.isArray(c?.aliases) ? c.aliases.map((a) => String(a).trim()).filter(Boolean) : [],
        website: String(c?.website ?? "").trim(),
      }))
    : current.competitors;

  const excludedDomains = Array.isArray(input.excludedDomains)
    ? Array.from(new Set(input.excludedDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)))
    : current.excludedDomains;

  const next: TrackingConfig = { settings, brand, keywords, competitors, excludedDomains };
  await writeConfig(projectId, next);
  return Response.json(next);
}
