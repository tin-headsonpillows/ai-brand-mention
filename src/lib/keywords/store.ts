import { readJson, writeJson } from "../blobJson";
import type { KeywordResearch } from "./types";

const path = (projectId: string) => `keywords/${projectId}.json`;

export function emptyResearch(projectId: string): KeywordResearch {
  return { projectId, updatedAt: null, category: "", taxonomy: [], keywords: [], clusters: [], volumeSource: "", mock: { taxonomy: false, volume: false, serp: false }, costUsd: 0 };
}

export async function readResearch(projectId: string): Promise<KeywordResearch> {
  const r = await readJson<KeywordResearch>(path(projectId));
  return r ? { ...emptyResearch(projectId), ...r } : emptyResearch(projectId);
}

export async function writeResearch(r: KeywordResearch): Promise<KeywordResearch> {
  r.updatedAt = new Date().toISOString();
  await writeJson(path(r.projectId), r);
  return r;
}
