import { deleteJson, readJson, writeJson } from "../blobJson";
import { DEFAULT_PROJECT } from "../tracking/store";
import type { PlaceDoc, PlaceRef, PlaceSettings, PlaceSummary } from "./types";

const INDEX_PATH = "reviews/index.json";
const placePath = (id: string) => `reviews/places/${id}.json`;

interface ReviewsIndex {
  places: PlaceSummary[];
}

/** 0 = the business's whole review history. */
export const MONTHS_BACK_OPTIONS = [3, 6, 12, 24, 0] as const;
export const MAX_REVIEWS_OPTIONS = [200, 500, 1000, 2000, 5000] as const;

export function projectsOf(p: { projectIds?: string[] }): string[] {
  return p.projectIds?.length ? p.projectIds : [DEFAULT_PROJECT];
}

export function summarize(doc: PlaceDoc): PlaceSummary {
  return {
    id: doc.id,
    projectIds: projectsOf(doc),
    name: doc.place.name,
    source: doc.place.source,
    dataId: doc.place.dataId,
    placeId: doc.place.placeId,
    propertyToken: doc.place.propertyToken,
    address: doc.place.address,
    rating: doc.place.rating,
    reviewCount: doc.place.reviewCount,
    thumbnail: doc.place.thumbnail,
    storedReviews: doc.reviews.length,
    lastSyncedAt: doc.lastSyncedAt,
  };
}

export async function listPlaces(projectId?: string): Promise<PlaceSummary[]> {
  const places = (await readJson<ReviewsIndex>(INDEX_PATH))?.places ?? [];
  return projectId ? places.filter((p) => projectsOf(p).includes(projectId)) : places;
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

function sameBusiness(a: Pick<PlaceRef, "dataId" | "placeId" | "propertyToken" | "source">, b: PlaceRef): boolean {
  if (a.source !== b.source) return false;
  return (
    (a.dataId !== undefined && a.dataId === b.dataId) ||
    (a.placeId !== undefined && a.placeId === b.placeId) ||
    (a.propertyToken !== undefined && a.propertyToken === b.propertyToken)
  );
}

/**
 * Adds a business to a project. A business that is already stored (in any project) is reused - its reviews
 * are never fetched twice - and simply gains the project.
 */
export async function createPlace(
  place: PlaceRef,
  settings: PlaceSettings,
  projectId: string
): Promise<{ doc: PlaceDoc; reused: boolean }> {
  const existing = (await listPlaces()).find((p) => sameBusiness(p, place));
  if (existing) {
    const doc = await readPlace(existing.id);
    if (doc) {
      const projects = projectsOf(doc);
      if (!projects.includes(projectId)) doc.projectIds = [...projects, projectId];
      await writePlace(doc);
      return { doc, reused: true };
    }
  }
  const doc: PlaceDoc = {
    id: crypto.randomUUID(),
    projectIds: [projectId],
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
  return { doc, reused: false };
}

/**
 * Changes how much history to keep. Widening it restarts the backfill from the newest page; stored reviews
 * are skipped, so only pages already fetched are paid for again.
 */
export async function updateSettings(id: string, settings: PlaceSettings): Promise<PlaceDoc | null> {
  const doc = await readPlace(id);
  if (!doc) return null;
  const before = doc.settings;
  const widerWindow = before.monthsBack !== 0 && (settings.monthsBack === 0 || settings.monthsBack > before.monthsBack);
  const higherCap = settings.maxReviews > before.maxReviews;
  doc.settings = settings;
  if ((widerWindow || higherCap) && doc.fetch.phase === "done") {
    doc.fetch = { phase: "backfill", nextPageToken: null, pagesFetched: 0, version: doc.fetch.version };
  }
  await writePlace(doc);
  return doc;
}

/** Takes the business out of one project; its stored reviews are deleted once no project uses it. */
export async function removeFromProject(id: string, projectId: string): Promise<void> {
  const doc = await readPlace(id);
  if (!doc) return;
  const remaining = projectsOf(doc).filter((p) => p !== projectId);
  if (remaining.length > 0) {
    doc.projectIds = remaining;
    await writePlace(doc);
    return;
  }
  const places = await listPlaces();
  await writeJson(INDEX_PATH, { places: places.filter((p) => p.id !== id) } satisfies ReviewsIndex);
  await deleteJson([placePath(id)]).catch(() => {
    // Already out of the index; an orphaned blob is unreachable and harmless.
  });
}
