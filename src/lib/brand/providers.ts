import Anthropic from "@anthropic-ai/sdk";
import { getOpenAIClient, isMockMode as openaiMissing } from "../openai";
import { hasServerApiKeys } from "../serpKeyPool";
import { serpRequest } from "../serpRequest";
import { extractDomain, flattenTextBlocks, mapReferences } from "../tracking/serpapi";
import type { TrackingSettings } from "../tracking/types";
import { CLAUDE_MODELS, WEB_SEARCH_PER_CALL, tokenCost } from "./pricing";
import type { Platform, SourceLink } from "./types";

export interface Answer {
  present: boolean;
  text: string;
  sources: SourceLink[];
  model?: string;
  costUsd: number;
  serpCredits: number;
  provider?: "openai" | "anthropic";
}

export function platformMock(platform: Platform): boolean {
  if (platform === "chatgpt") return openaiMissing();
  if (platform === "claude") return !process.env.ANTHROPIC_API_KEY?.trim();
  return !hasServerApiKeys();
}

function dedupeSources(list: SourceLink[], max = 20): SourceLink[] {
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const s of list) {
    const key = s.url.replace(/#.*$/, "").replace(/\/$/, "");
    if (!s.url || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const toLinks = (refs: ReturnType<typeof mapReferences>): SourceLink[] =>
  refs.map((r) => ({ title: r.title || r.source || r.domain, url: r.link, domain: r.domain }));

// --- Google (SerpApi) -------------------------------------------------------------------------------------

export async function askAiMode(prompt: string, settings: TrackingSettings): Promise<Answer> {
  const data = (await serpRequest({ engine: "google_ai_mode", q: prompt, gl: settings.country, hl: settings.language })) as {
    text_blocks?: Parameters<typeof flattenTextBlocks>[0];
    references?: Parameters<typeof mapReferences>[0];
  };
  const text = flattenTextBlocks(data.text_blocks);
  return { present: text.length > 0, text, sources: dedupeSources(toLinks(mapReferences(data.references))), costUsd: 0, serpCredits: 1 };
}

/** Google search page 1; the AI Overview is either inline or behind a page_token redeemed with a second search. */
export async function askAiOverview(prompt: string, settings: TrackingSettings): Promise<Answer> {
  const page = (await serpRequest({ engine: "google", q: prompt, gl: settings.country, hl: settings.language, device: settings.device })) as {
    ai_overview?: { text_blocks?: Parameters<typeof flattenTextBlocks>[0]; references?: Parameters<typeof mapReferences>[0]; page_token?: string };
  };
  let overview = page.ai_overview;
  let credits = 1;
  if (overview?.page_token && !overview.text_blocks?.length) {
    const full = (await serpRequest({ engine: "google_ai_overview", page_token: overview.page_token })) as { ai_overview?: typeof overview };
    overview = full.ai_overview;
    credits++;
  }
  const text = flattenTextBlocks(overview?.text_blocks);
  return { present: text.length > 0, text, sources: dedupeSources(toLinks(mapReferences(overview?.references))), costUsd: 0, serpCredits: credits };
}

// --- ChatGPT (OpenAI Responses API + web search) -------------------------------------------------------------

export async function askChatGpt(prompt: string, settings: TrackingSettings, model: string): Promise<Answer> {
  const client = getOpenAIClient();
  const response = await client.responses.create({
    model,
    input: prompt,
    tools: [{ type: "web_search", user_location: { type: "approximate", country: settings.country.toUpperCase() } }],
    reasoning: { effort: "low" },
  });
  const sources: SourceLink[] = [];
  let searches = 0;
  for (const item of response.output) {
    if (item.type === "web_search_call") searches++;
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation") sources.push({ title: a.title || extractDomain(a.url), url: a.url, domain: extractDomain(a.url) });
        }
      }
    }
  }
  const usage = response.usage;
  const costUsd =
    (usage
      ? tokenCost(model, { input: usage.input_tokens, output: usage.output_tokens, cachedInput: usage.input_tokens_details?.cached_tokens ?? 0 })
      : 0) +
    searches * WEB_SEARCH_PER_CALL;
  const text = response.output_text ?? "";
  // Strip the markdown link noise ChatGPT appends after cited sentences: ([site](url)).
  const clean = text.replace(/\s*\(\[[^\]]+\]\([^)]+\)\)/g, "").trim();
  return { present: clean.length > 0, text: clean, sources: dedupeSources(sources), model: response.model ?? model, costUsd, serpCredits: 0, provider: "openai" };
}

// --- Claude (Messages API + web search) ------------------------------------------------------------------------

let anthropic: Anthropic | null = null;
function claudeClient(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), maxRetries: 2, timeout: 120_000 });
  return anthropic;
}

/** Models with server-side refusal fallback ("default" routing) and the dynamic-filtering web search tool. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
const NEW_SEARCH_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export async function askClaude(prompt: string, settings: TrackingSettings, model: string): Promise<Answer> {
  const client = claudeClient();
  const fallbacks = FALLBACK_MODELS.has(model);
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    NEW_SEARCH_MODELS.has(model)
      ? { type: "web_search_20260209", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: settings.country.toUpperCase() } }
      : { type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: settings.country.toUpperCase() } },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  let costUsd = 0;
  let servedBy = model;
  let response: Anthropic.Beta.BetaMessage | null = null;
  // Server-side web search can pause after its internal loop; resume by sending the paused turn back.
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      tools,
      output_config: { effort: "low" },
      messages,
      ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    servedBy = response.model || model;
    const u = response.usage;
    costUsd +=
      tokenCost(servedBy, {
        input: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        cachedInput: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens,
      }) + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_PER_CALL;
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  if (!response) throw new Error("Claude returned nothing");
  if (response.stop_reason === "refusal") throw Object.assign(new Error("Claude declined to answer this prompt"), { costUsd });

  const parts: string[] = [];
  const cited: SourceLink[] = [];
  const searched: SourceLink[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      parts.push(block.text);
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") cited.push({ title: c.title ?? extractDomain(c.url), url: c.url, domain: extractDomain(c.url) });
      }
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r.type === "web_search_result") searched.push({ title: r.title, url: r.url, domain: extractDomain(r.url) });
      }
    }
  }
  const text = parts.join("").trim();
  return {
    present: text.length > 0,
    text,
    sources: dedupeSources(cited.length ? cited : searched),
    model: servedBy,
    costUsd,
    serpCredits: 0,
    provider: "anthropic",
  };
}

export const knownClaudeModel = (id: string) => CLAUDE_MODELS.some((m) => m.id === id);

// --- Placeholders (no keys) -----------------------------------------------------------------------------------

const MOCK_SITES = ["tripadvisor.com", "lonelyplanet.com", "booking.com", "reddit.com", "travelandleisure.com", "cntraveler.com", "google.com"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic stand-in answers so the dashboard can be explored before keys are configured. */
export function mockAnswer(platform: Platform, prompt: string, brand: string, competitors: string[]): Answer {
  const h = hash(`${platform}:${prompt}`);
  const present = platform !== "aiOverview" || h % 4 !== 0;
  if (!present) return { present: false, text: "", sources: [], costUsd: 0, serpCredits: 2 };
  const others = competitors.length ? competitors : ["Heritage Line", "Paradise Cruises", "Indochina Junk"];
  const mentionBrand = h % 5 !== 0;
  const first = mentionBrand && h % 3 === 0 ? brand : others[h % others.length];
  const rest = others.filter((o) => o !== first);
  const second = first === brand ? others[(h >> 3) % others.length] : mentionBrand ? brand : rest[(h >> 2) % rest.length] ?? others[0];
  const praise = ["attentive, personalised service", "quieter routes away from the crowds", "high-quality seafood menus", "spacious cabins with sea views", "strong guest reviews"];
  const critique = ["older vessels showing their age", "itineraries that change with the weather", "premium prices", "fixed schedules with little flexibility"];
  const text = [
    `For "${prompt}", travellers most often shortlist ${first} and ${second}.`,
    `${first} is known for ${praise[h % praise.length]} and ${praise[(h >> 4) % praise.length]}.`,
    `${second} stands out for ${praise[(h >> 5) % praise.length]}, though some reviews mention ${critique[(h >> 2) % critique.length]}.`,
    mentionBrand && brand !== first && brand !== second ? `${brand} is another option worth comparing.` : "",
    `Book ahead in peak season and compare what each cruise includes.`,
  ]
    .filter(Boolean)
    .join(" ");
  const sources = Array.from({ length: 2 + (h % 4) }, (_, i) => {
    const domain = MOCK_SITES[(h + i * 7) % MOCK_SITES.length];
    return { title: `${domain} - ${prompt}`, url: `https://www.${domain}/${encodeURIComponent(prompt.toLowerCase().replace(/\s+/g, "-"))}-${i}`, domain };
  });
  const llm = platform === "chatgpt" || platform === "claude";
  return {
    present: true,
    text,
    sources: dedupeSources(sources),
    model: llm ? `${platform === "chatgpt" ? "chatgpt" : "claude"}-mock` : undefined,
    costUsd: 0,
    serpCredits: platform === "aiMode" ? 1 : llm ? 0 : 2,
  };
}
