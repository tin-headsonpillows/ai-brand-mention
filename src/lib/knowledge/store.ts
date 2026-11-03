import { readJson, writeJson } from "../blobJson";
import type { KnowledgeBase } from "./types";

const path = (projectId: string) => `knowledge/${projectId}.json`;

export function emptyKnowledgeBase(projectId: string): KnowledgeBase {
  return { projectId, updatedAt: null, site: null, serp: null, profile: null, notes: [], costUsd: 0 };
}

export async function readKnowledgeBase(projectId: string): Promise<KnowledgeBase> {
  const kb = await readJson<KnowledgeBase>(path(projectId));
  return kb ? { ...emptyKnowledgeBase(projectId), ...kb } : emptyKnowledgeBase(projectId);
}

/** Read-modify-write; the caller's change is applied to the latest stored copy. */
export async function updateKnowledgeBase(projectId: string, change: (kb: KnowledgeBase) => KnowledgeBase | void): Promise<KnowledgeBase> {
  const kb = await readKnowledgeBase(projectId);
  const next = change(kb) ?? kb;
  next.updatedAt = new Date().toISOString();
  await writeJson(path(projectId), next);
  return next;
}
