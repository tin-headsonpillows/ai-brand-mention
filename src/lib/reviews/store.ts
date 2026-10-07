import { deleteJson, readJson, writeJson } from "../blobJson";
import type { PlaceDoc, PlaceRef, PlaceSettings, PlaceSummary } from "./types";

const INDEX_PATH = "reviews/index.json";
const placePath = (id: string) => `reviews/places/${id}.json`;

interface ReviewsIndex {
  places: PlaceSummary[];
}

export const MONTHS_BACK_OPTIONS = [3, 6, 12, 24] as const;
export const MAX_REVIEWS_OPTIONS = [200, 500, 1000, 2000] as const;

export function summarize(doc: PlaceDoc): PlaceSummary {
  return {
    id: doc.id,
    name: doc.place.name,
    source: doc.place.source,
    address: doc.place.address,
    rating: doc.place.rating,
    reviewCount: doc.place.reviewCount,
    thumbnail: doc.place.thumbnail,
    storedReviews: doc.reviews.length,
    lastSyncedAt: doc.lastSyncedAt,
  };
}

export async function listPlaces(): Promise<PlaceSummary[]> {
  return (await readJson<ReviewsIndex>(INDEX_PATH))?.places ?? [];
}

export async function readPlace(id: string): Promise<PlaceDoc | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  return readJson<PlaceDoc>(placePath(id));
}

/** Saves the place and refreshes its row in the index. */
export async function writePlace(doc: PlaceDoc): Promise<void> {
  await writeJson(placePath(doc.id), doc);
  const places = await listPlaces();
  const summary = summarize(doc);
  const at = places.findIndex((p) => p.id === doc.id);
  if (at === -1) places.push(summary);
  else places[at] = summary;
  await writeJson(INDEX_PATH, { places } satisfies ReviewsIndex);
}

export async function createPlace(place: PlaceRef, settings: PlaceSettings): Promise<PlaceDoc> {
  const existing = (await listPlaces()).find((p) => p.source === place.source && p.name === place.name);
  if (existing) {
    const doc = await readPlace(existing.id);
    if (doc && sameBusiness(doc.place, place)) return doc;
  }
  const doc: PlaceDoc = {
    id: crypto.randomUUID(),
    place,
    settings,
    createdAt: new Date().toISOString(),
    lastSyncedAt: null,
    fetch: { phase: "backfill", nextPageToken: null, pagesFetched: 0 },
    taxonomy: [],
    topics: [],
    analyzer: null,
    searchesUsed: 0,
    reviews: [],
  };
  await writePlace(doc);
  return doc;
}

function sameBusiness(a: PlaceRef, b: PlaceRef): boolean {
  return (
    (a.dataId !== undefined && a.dataId === b.dataId) ||
    (a.placeId !== undefined && a.placeId === b.placeId) ||
    (a.propertyToken !== undefined && a.propertyToken === b.propertyToken)
  );
}

export async function deletePlace(id: string): Promise<void> {
  const places = await listPlaces();
  await writeJson(INDEX_PATH, { places: places.filter((p) => p.id !== id) } satisfies ReviewsIndex);
  await deleteJson([placePath(id)]).catch(() => {
    // Already out of the index; an orphaned blob is unreachable and harmless.
  });
}
