import { get, put } from "@vercel/blob";
import { RESULT_DEPTHS, type KeywordHistory, type TrackingConfig } from "./types";

const CONFIG_PATH = "tracking/config.json";
const HISTORY_PREFIX = "tracking/history";

function historyPath(keywordId: string): string {
  return `${HISTORY_PREFIX}/${keywordId}.json`;
}

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

function defaultConfig(): TrackingConfig {
  return {
    settings: { language: "en", country: "us", device: "mobile", resultDepth: 20 },
    keywords: [],
    brand: { name: "", aliases: [], website: "" },
    competitors: [],
    excludedDomains: [],
  };
}

export async function readConfig(): Promise<TrackingConfig> {
  const config = await readJson<TrackingConfig>(CONFIG_PATH);
  if (!config) return defaultConfig();
  // Backfill fields added after some configs were already saved to the blob store.
  const defaults = defaultConfig();
  const settings = { ...defaults.settings, ...config.settings };
  // Depths above 20 were briefly allowed; anything outside the current options falls back to 20.
  if (!RESULT_DEPTHS.includes(settings.resultDepth)) settings.resultDepth = defaults.settings.resultDepth;
  return { ...defaults, ...config, settings };
}

export async function writeConfig(config: TrackingConfig): Promise<void> {
  await writeJson(CONFIG_PATH, config);
}

export async function readHistory(keywordId: string): Promise<KeywordHistory | null> {
  return readJson<KeywordHistory>(historyPath(keywordId));
}

export async function writeHistory(history: KeywordHistory): Promise<void> {
  await writeJson(historyPath(history.keywordId), history);
}
