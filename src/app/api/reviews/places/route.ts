import type { NextRequest } from "next/server";
import { isMockMode } from "@/lib/openai";
import { isReviewsMock } from "@/lib/reviews/serpapi";
import { MAX_REVIEWS_OPTIONS, MONTHS_BACK_OPTIONS, createPlace, deletePlace, listPlaces } from "@/lib/reviews/store";
import type { PlaceRef } from "@/lib/reviews/types";

export async function GET() {
  return Response.json({
    places: await listPlaces(),
    mock: { reviews: isReviewsMock(), analysis: isMockMode() },
  });
}

const optionalString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : undefined);
const optionalNumber = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { place?: Record<string, unknown>; monthsBack?: unknown; maxReviews?: unknown } | null;
  const raw = body?.place;
  const name = optionalString(raw?.name);
  const source = raw?.source === "hotels" ? "hotels" : raw?.source === "maps" ? "maps" : null;
  if (!raw || !name || !source) return Response.json({ error: "Pick a business first" }, { status: 400 });

  const place: PlaceRef = {
    source,
    name,
    dataId: optionalString(raw.dataId),
    placeId: optionalString(raw.placeId),
    propertyToken: optionalString(raw.propertyToken),
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

  const monthsBack = (MONTHS_BACK_OPTIONS as readonly number[]).includes(Number(body?.monthsBack)) ? Number(body?.monthsBack) : 12;
  const maxReviews = (MAX_REVIEWS_OPTIONS as readonly number[]).includes(Number(body?.maxReviews)) ? Number(body?.maxReviews) : 500;
  const doc = await createPlace(place, { monthsBack, maxReviews });
  return Response.json({ id: doc.id });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  await deletePlace(id);
  return Response.json({ ok: true });
}
