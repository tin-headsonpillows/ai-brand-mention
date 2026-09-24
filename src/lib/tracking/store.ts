import { del, get, put } from "@vercel/blob";
import { RESULT_DEPTHS, type KeywordHistory, type TrackingConfig } from "./types";

/**
 * Tracking is organised in projects (one brand/site each). The first project keeps the blob paths
 * it had before projects existed ("tracking/config.json", "tracking/history/..."), so its data never
 * has to move; every later project lives under "tracking/projects/<id>/".
 */
export const DEFAULT_PROJECT = "default";
const PROJECTS_PATH = "tracking/projects.json";

interface ProjectIndex {
  projects: string[];
}

function prefix(projectId: string): string {
  return projectId === DEFAULT_PROJECT ? "tracking" : `tracking/projects/${projectId}`;
}

const configPath = (projectId: string) => `${prefix(projectId)}/config.json`;
const historyPath = (projectId: string, keywordId: string) => `${prefix(projectId)}/history/${keywordId}.json`;

async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return (await new Response(result.stream).json()) as T;
  } catch {
    // Blob store unreachable (e.g. no BLOB_READ_WRITE_TOKEN in this environment) - treat as not-yet-created.
    return null;
  }
}

async function writeJson(pathname: string, data: unknown): Promise<void> {
  await put(pathname, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export function defaultConfig(): TrackingConfig {
  return {
    settings: { language: "en", country: "us", device: "mobile", resultDepth: 20 },
    keywords: [],
    brand: { name: "", aliases: [], website: "" },
    competitors: [],
    excludedDomains: [],
  };
}

export async function listProjectIds(): Promise<string[]> {
  const index = await readJson<ProjectIndex>(PROJECTS_PATH);
  return index?.projects?.length ? index.projects : [DEFAULT_PROJECT];
}

/** Returns the project id if it exists, so routes never read or write an unknown project's paths. */
export async function resolveProject(requested: string | null): Promise<string | null> {
  const id = requested || DEFAULT_PROJECT;
  const ids = await listProjectIds();
  return ids.includes(id) ? id : null;
}

export async function createProject(config: TrackingConfig): Promise<string> {
  const ids = await listProjectIds();
  const id = crypto.randomUUID();
  await writeConfig(id, config);
  await writeJson(PROJECTS_PATH, { projects: [...ids, id] } satisfies ProjectIndex);
  return id;
}

export async function deleteProject(projectId: string): Promise<void> {
  const ids = await listProjectIds();
  if (!ids.includes(projectId)) return;
  if (ids.length <= 1) throw new Error("Can't delete the only project");
  const config = await readConfig(projectId);
  await writeJson(PROJECTS_PATH, { projects: ids.filter((id) => id !== projectId) } satisfies ProjectIndex);
  const paths = [configPath(projectId), ...config.keywords.map((k) => historyPath(projectId, k.id))];
  await del(paths).catch(() => {
    // The project is already gone from the index; leftover blobs are unreachable and harmless.
  });
}

export async function readConfig(projectId: string): Promise<TrackingConfig> {
  const config = await readJson<TrackingConfig>(configPath(projectId));
  if (!config) return defaultConfig();
  // Backfill fields added after some configs were already saved to the blob store.
  const defaults = defaultConfig();
  const settings = { ...defaults.settings, ...config.settings };
  // Depths above 20 were briefly allowed; anything outside the current options falls back to 20.
  if (!RESULT_DEPTHS.includes(settings.resultDepth)) settings.resultDepth = defaults.settings.resultDepth;
  return { ...defaults, ...config, settings };
}

export async function writeConfig(projectId: string, config: TrackingConfig): Promise<void> {
  await writeJson(configPath(projectId), config);
}

export async function readHistory(projectId: string, keywordId: string): Promise<KeywordHistory | null> {
  return readJson<KeywordHistory>(historyPath(projectId, keywordId));
}

export async function writeHistory(projectId: string, history: KeywordHistory): Promise<void> {
  await writeJson(historyPath(projectId, history.keywordId), history);
}
