import type { NextRequest } from "next/server";
import { CHATGPT_MODELS, CLAUDE_MODELS } from "@/lib/brand/pricing";
import { setDailyLimit } from "@/lib/brand/spend";
import { readSettings, writeSettings } from "@/lib/brand/store";
import { PLATFORMS, type BrandSettings } from "@/lib/brand/types";
import { resolveProject } from "@/lib/tracking/store";

/** Project settings (platforms, models, schedule) and the shared daily spending limit. */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | (Partial<Omit<BrandSettings, "reviewListings">> & { project?: unknown; dailyLimitUsd?: unknown; reviewListings?: unknown[] | null })
    | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const current = await readSettings(projectId);
  const next: BrandSettings = {
    platforms: Object.fromEntries(PLATFORMS.map((p) => [p, typeof body?.platforms?.[p] === "boolean" ? body.platforms[p] : current.platforms[p]])) as BrandSettings["platforms"],
    chatgptModel: CHATGPT_MODELS.some((m) => m.id === body?.chatgptModel) ? (body?.chatgptModel as string) : current.chatgptModel,
    claudeModel: CLAUDE_MODELS.some((m) => m.id === body?.claudeModel) ? (body?.claudeModel as string) : current.claudeModel,
    schedule: body?.schedule === "off" || body?.schedule === "weekly" ? body.schedule : current.schedule,
    refreshReviews: typeof body?.refreshReviews === "boolean" ? body.refreshReviews : current.refreshReviews,
    // null = back to automatic matching; a list = exactly these listings (ids are checked when read).
    reviewListings:
      body?.reviewListings === null
        ? undefined
        : Array.isArray(body?.reviewListings)
          ? body.reviewListings.filter((id): id is string => typeof id === "string" && /^[\w-]{1,80}$/.test(id)).slice(0, 20)
          : current.reviewListings,
  };
  await writeSettings(projectId, next);
  if (typeof body?.dailyLimitUsd === "number" && Number.isFinite(body.dailyLimitUsd)) await setDailyLimit(body.dailyLimitUsd);
  return Response.json({ settings: next });
}
