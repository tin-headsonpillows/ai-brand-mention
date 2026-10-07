import { getSharedRotator } from "./serpKeyPool";

const BASE_URL = "https://serpapi.com/search.json";

type Json = Record<string, unknown>;

const KEY_PROBLEM = /run out|searches? (per|left)|limit|invalid api key|api key|account|plan|unauthori[sz]ed|forbidden/i;

/**
 * One SerpApi call through the shared key pool. Only key problems (quota, bad key) throw inside the
 * rotator, which moves on to the next key for good; a bad request or "no results" must not, or one
 * malformed input would burn through every key. "No results" comes back as an empty object.
 */
export async function serpRequest(params: Record<string, string>): Promise<Json> {
  const data = await getSharedRotator().run(async (apiKey) => {
    const res = await fetch(`${BASE_URL}?${new URLSearchParams({ ...params, api_key: apiKey }).toString()}`);
    const body = (await res.json().catch(() => ({}))) as Json;
    const error = typeof body.error === "string" ? body.error : undefined;
    if (error && /hasn't returned any results/i.test(error)) return {};
    if (res.status === 401 || res.status === 403 || res.status === 429 || (error && KEY_PROBLEM.test(error))) {
      throw new Error(`SerpApi key problem: ${error ?? `HTTP ${res.status}`}`);
    }
    if (!res.ok || error) return { __requestError: `SerpApi ${params.engine}: ${error ?? `HTTP ${res.status}`}` };
    return body;
  });
  if (typeof data.__requestError === "string") throw new Error(data.__requestError);
  return data;
}
