import type { NextRequest } from "next/server";
import { customerVoice } from "@/lib/brand/customers";
import { updateCustomerGap } from "@/lib/brand/gap";
import { BudgetExceeded } from "@/lib/brand/spend";
import { readCustomerGap, readSettings } from "@/lib/brand/store";
import { readConfig, resolveProject } from "@/lib/tracking/store";

const RANGES: Record<string, number | null> = { "30": 30, "90": 90, "180": 180, "365": 365, all: null };

/** What customers say in the brand's reviews (Google Maps, Tripadvisor, Google Hotels) and how it compares with AI answers. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const projectId = await resolveProject(p.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const range = p.get("range") ?? "365";
  const days = range in RANGES ? RANGES[range] : 365;
  const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  const [config, settings, gap] = await Promise.all([readConfig(projectId), readSettings(projectId), readCustomerGap(projectId)]);
  const voice = await customerVoice(projectId, config, settings, since);
  return Response.json({ voice, gap, refreshReviews: settings.refreshReviews }, { headers: { "Cache-Control": "no-store" } });
}

/** Compares the latest run's AI answers with the brand's reviews again (one small OpenAI call). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { project?: unknown } | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const [config, settings] = await Promise.all([readConfig(projectId), readSettings(projectId)]);
  try {
    const { gap, reason } = await updateCustomerGap(projectId, config, settings);
    if (!gap) return Response.json({ error: reason ?? "Nothing to compare yet" }, { status: 400 });
    return Response.json({ gap });
  } catch (err) {
    const status = err instanceof BudgetExceeded ? 429 : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Comparison failed" }, { status });
  }
}
