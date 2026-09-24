import type { NextRequest } from "next/server";
import { readConfig, writeConfig } from "@/lib/tracking/store";
import type { TrackingConfig } from "@/lib/tracking/types";

export async function GET() {
  const config = await readConfig();
  return Response.json(config);
}

function isValidDevice(v: unknown): v is TrackingConfig["settings"]["device"] {
  return v === "desktop" || v === "tablet" || v === "mobile";
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = body as Partial<TrackingConfig>;
  const current = await readConfig();

  const settings = input.settings
    ? {
        language: String(input.settings.language || current.settings.language).trim() || "en",
        country: String(input.settings.country || current.settings.country).trim() || "us",
        device: isValidDevice(input.settings.device) ? input.settings.device : current.settings.device,
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

  const next: TrackingConfig = { settings, brand, keywords };
  await writeConfig(next);
  return Response.json(next);
}
