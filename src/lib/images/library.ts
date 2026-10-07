import { deleteJson, readBinary, readJson, writeBinary, writeJson } from "../blobJson";
import type { LibraryItem } from "./types";

/** Per-project image library: one index plus one file per image, in the private Blob store. */
const indexPath = (projectId: string) => `images/${projectId}/index.json`;
const filePath = (projectId: string, id: string) => `images/${projectId}/files/${id}`;

interface LibraryIndex {
  items: LibraryItem[];
}

const validId = (id: string) => /^[\w-]{1,80}$/.test(id);

export async function listLibrary(projectId: string): Promise<LibraryItem[]> {
  return (await readJson<LibraryIndex>(indexPath(projectId)))?.items ?? [];
}

export async function saveToLibrary(
  projectId: string,
  meta: Omit<LibraryItem, "id" | "createdAt" | "bytes">,
  data: Uint8Array
): Promise<LibraryItem> {
  const item: LibraryItem = { ...meta, id: crypto.randomUUID(), createdAt: new Date().toISOString(), bytes: data.byteLength };
  await writeBinary(filePath(projectId, item.id), data, item.contentType);
  const items = await listLibrary(projectId);
  await writeJson(indexPath(projectId), { items: [item, ...items] } satisfies LibraryIndex);
  return item;
}

/** Saves several images with one index update (imports from search results). */
export async function saveManyToLibrary(
  projectId: string,
  entries: Array<{ meta: Omit<LibraryItem, "id" | "createdAt" | "bytes">; data: Uint8Array }>
): Promise<LibraryItem[]> {
  const created: LibraryItem[] = [];
  for (const { meta, data } of entries) {
    const item: LibraryItem = { ...meta, id: crypto.randomUUID(), createdAt: new Date().toISOString(), bytes: data.byteLength };
    await writeBinary(filePath(projectId, item.id), data, item.contentType);
    created.push(item);
  }
  if (created.length) {
    const items = await listLibrary(projectId);
    await writeJson(indexPath(projectId), { items: [...created, ...items] } satisfies LibraryIndex);
  }
  return created;
}

export async function readLibraryFile(projectId: string, id: string): Promise<{ data: Uint8Array; item: LibraryItem } | null> {
  if (!validId(id)) return null;
  const item = (await listLibrary(projectId)).find((i) => i.id === id);
  if (!item) return null;
  const data = await readBinary(filePath(projectId, id));
  return data ? { data, item } : null;
}

export async function deleteFromLibrary(projectId: string, id: string): Promise<void> {
  if (!validId(id)) return;
  const items = await listLibrary(projectId);
  await writeJson(indexPath(projectId), { items: items.filter((i) => i.id !== id) } satisfies LibraryIndex);
  await deleteJson([filePath(projectId, id)]).catch(() => {
    // Out of the index already; an orphaned file is unreachable.
  });
}
