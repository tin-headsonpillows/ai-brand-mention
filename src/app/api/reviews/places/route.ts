import type { NextRequest } from "next/server";
import { isMockMode } from "@/lib/openai";
import { isReviewsMock } from "@/lib/reviews/serpapi";
import {
  MAX_REVIEWS_OPTIONS,
  MONTHS_BACK_OPTIONS,
  createPlace,
  listPlaces,
  readPlace,
  removeFromProject,
  updateSettings,
} from "@/lib/reviews/store";
import { resolveProject } from "@/lib/tracking/store";
import type { PlaceRef, PlaceSettings } from "@/lib/reviews/types";

export async function GET(req: NextRequest) {
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  return Response.json({
    places: await listPlaces(projectId),
    mock: { reviews: isReviewsMock(), analysis: isMockMode() },
  });
}

const optionalString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : undefined);
const optionalNumber = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parseSettings(body: { monthsBack?: unknown; maxReviews?: unknown } | null, fallback: PlaceSettings): PlaceSettings {
  const months = Number(body?.monthsBack);
  const cap = Number(body?.maxReviews);
  return {
    monthsBack: body?.monthsBack !== undefined && (MONTHS_BACK_OPTIONS as readonly number[]).includes(months) ? months : fallback.monthsBack,
    maxReviews: body?.maxReviews !== undefined && (MAX_REVIEWS_OPTIONS as readonly number[]).includes(cap) ? cap : fallback.maxReviews,
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { place?: Record<string, unknown>; monthsBack?: unknown; maxReviews?: unknown; project?: unknown }
    | null;
  const projectId = await resolveProject(typeof body?.project === "string" ? body.project : null);
  if (!projectId) return Response.json({ error: "Unknown project" }, { status: 404 });
  const raw = body?.place;
  const name = optionalString(raw?.name);
  const source = raw?.source === "hotels" || raw?.source === "maps" || raw?.source === "tripadvisor" ? raw.source : null;
  if (!raw || !name || !source) return Response.json({ error: "Pick a business first" }, { status: 400 });

  const place: PlaceRef = {
    source,
    name,
    dataId: optionalString(raw.dataId),
    placeId: optionalString(raw.placeId),
    propertyToken: optionalString(raw.propertyToken),
    tripadvisorId: /^\d{1,12}$/.test(String(raw.tripadvisorId ?? "")) ? String(raw.tripadvisorId) : undefined,
    link: optionalString(raw.link),
    address: optionalString(raw.address),
    rating: optionalNumber(raw.rating),
    reviewCount: optionalNumber(raw.reviewCount),
    type: optionalString(raw.type),
    thumbnail: optionalString(raw.thumbnail),
    website: optionalString(raw.website),
  };
  if (source === "maps" && !place.dataId && !place.placeId) {
    return Response.json({ error: "This result has no Google Maps ID" }, { status: 400 });
  }
  if (source === "hotels" && !place.propertyToken) {
    return Response.json({ error: "This result has no Google Hotels property token" }, { status: 400 });
  }
  if (source === "tripadvisor" && !place.tripadvisorId) {
    return Response.json({ error: "This result has no Tripadvisor ID" }, { status: 400 });
  }

  const { doc, reused } = await createPlace(place, parseSettings(body, { monthsBack: 12, maxReviews: 500 }), projectId);
  return Response.json({ id: doc.id, reused });
}

/** Change a business's history window / review cap. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; monthsBack?: unknown; maxReviews?: unknown } | null;
  const doc = await readPlace(typeof body?.id === "string" ? body.id : "");
  if (!doc) return Response.json({ error: "Unknown business" }, { status: 404 });
  const updated = await updateSettings(doc.id, parseSettings(body, doc.settings));
  return Response.json({ ok: true, settings: updated?.settings, phase: updated?.fetch.phase });
}

/** Removes the business from a project (its stored reviews go once no project uses it). */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const projectId = await resolveProject(req.nextUrl.searchParams.get("project"));
  if (!id || !projectId) return Response.json({ error: "Missing id or project" }, { status: 400 });
  await removeFromProject(id, projectId);
  return Response.json({ ok: true });
}
