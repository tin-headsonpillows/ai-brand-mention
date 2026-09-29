import { createChatCompletion } from "./execute";
import { runWithConcurrency } from "./concurrency";
import { matchesBrand } from "./mentions";
import type { Leaderboard, LeaderboardEntry, PromptResult } from "./types";

const CHUNK_SIZE = 20;
const EXTRACT_CONCURRENCY = 4;
/** Names beyond this (the rarest ones) skip the dedupe call and stand alone, to keep its output bounded. */
const MAX_NAMES_TO_CONSOLIDATE = 400;

/** One business named in one answer, at its 1-based place in that answer's list. */
interface RawMention {
  name: string;
  index: number;
  position: number;
}

/** Every mention in the run, already mapped to a canonical business and its parent brand. */
export interface MentionIndex {
  mentions: Array<{ business: string; brand: string; index: number; position: number }>;
}

interface ChunkExtraction {
  responses?: Array<{ index?: unknown; businesses?: unknown }>;
}

interface ConsolidationResult {
  groups?: Array<{ name?: unknown; brand?: unknown; members?: unknown }>;
}

/**
 * Finds every business/brand the answers recommend (not just the user's brand and named competitors)
 * and resolves name variants to one canonical business plus its parent brand/chain. The model does the
 * extraction since this is open-ended entity recognition, not a fixed term to regex-match. Consolidation
 * runs once over the whole run, so the same business carries the same name in every location.
 */
export async function indexMentions(
  results: PromptResult[],
  model: string,
  mock: boolean,
  apiKey?: string
): Promise<MentionIndex> {
  const usable = results.filter((r) => !r.error && r.response.trim());
  if (usable.length === 0) return { mentions: [] };
  if (mock) return mockIndex(usable);

  const chunks: PromptResult[][] = [];
  for (let i = 0; i < usable.length; i += CHUNK_SIZE) chunks.push(usable.slice(i, i + CHUNK_SIZE));

  const raw: RawMention[] = [];
  await runWithConcurrency(
    chunks,
    EXTRACT_CONCURRENCY,
    (chunk) => extractChunk(chunk, model, apiKey),
    (mentions) => raw.push(...mentions),
    () => false
  );
  if (raw.length === 0) return { mentions: [] };

  const groups = await consolidate(raw, model, apiKey);
  return {
    mentions: raw.map((m) => {
      const group = groups.get(m.name.toLowerCase());
      return { business: group?.name ?? m.name, brand: group?.brand ?? m.name, index: m.index, position: m.position };
    }),
  };
}

async function extractChunk(chunk: PromptResult[], model: string, apiKey?: string): Promise<RawMention[]> {
  const known = new Set(chunk.map((r) => r.index));
  const listing = chunk.map((r) => `[${r.index}] ${r.response}`).join("\n\n");
  try {
    const completion = await createChatCompletion(
      {
        model,
        messages: [
          {
            role: "system",
            content: [
              "You read numbered AI assistant answers and list, for each answer, the businesses, brands, venues or places it recommends or offers as options - in the order they appear in that answer.",
              "Use the specific name as written (e.g. \"InterContinental Danang Sun Peninsula Resort\", not \"InterContinental\").",
              "Skip the city or area the question itself is about, and booking sites or apps mentioned only as where to book.",
              'Return ONLY JSON: {"responses": [{"index": number, "businesses": string[]}]}, using each answer\'s bracketed number as its index.',
            ].join(" "),
          },
          { role: "user", content: listing },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      },
      apiKey
    );
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as ChunkExtraction;
    const out: RawMention[] = [];
    for (const item of parsed.responses ?? []) {
      const index = typeof item.index === "number" || typeof item.index === "string" ? Number(item.index) : NaN;
      if (!known.has(index) || !Array.isArray(item.businesses)) continue;
      const seen = new Set<string>();
      let position = 0;
      for (const value of item.businesses) {
        const name = typeof value === "string" ? value.trim() : "";
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        out.push({ name, index, position: ++position });
      }
    }
    return out;
  } catch {
    return []; // skip a malformed/failed chunk rather than failing the whole leaderboard
  }
}

/** Maps each raw name (lowercased) to its canonical business name and parent brand. */
async function consolidate(
  raw: RawMention[],
  model: string,
  apiKey?: string
): Promise<Map<string, { name: string; brand: string }>> {
  // Distinct names, most-mentioned first; the first spelling seen stands for its case variants.
  const counts = new Map<string, { name: string; count: number }>();
  for (const m of raw) {
    const key = m.name.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { name: m.name, count: 1 });
  }
  const names = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .map((e) => e.name);

  const groups = new Map<string, { name: string; brand: string }>();
  for (const name of names) groups.set(name.toLowerCase(), { name, brand: name });

  const toConsolidate = names.slice(0, MAX_NAMES_TO_CONSOLIDATE);
  try {
    const completion = await createChatCompletion(
      {
        model,
        messages: [
          {
            role: "system",
            content: [
              "You are deduplicating business names extracted from many AI answers.",
              'Group entries that refer to the same real business under different spellings or phrasing (e.g. "Furama Resort" and "Furama Resort Danang"), but never merge genuinely different businesses - two properties of the same chain in different places stay separate.',
              "For each group give a canonical name and its brand: the hotel chain or parent brand a traveler would recognise (e.g. \"Vinpearl\", \"InterContinental\", \"Novotel\"), or the canonical name itself when the business is independent.",
              'Every entry number must appear in exactly one group. Return ONLY JSON: {"groups": [{"name": string, "brand": string, "members": number[]}]}.',
            ].join(" "),
          },
          { role: "user", content: toConsolidate.map((n, i) => `${i}. ${n}`).join("\n") },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      },
      apiKey
    );
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as ConsolidationResult;
    for (const group of parsed.groups ?? []) {
      const members = Array.isArray(group.members)
        ? group.members.filter((n): n is number => typeof n === "number" && n >= 0 && n < toConsolidate.length)
        : [];
      if (members.length === 0) continue;
      const name = typeof group.name === "string" && group.name.trim() ? group.name.trim() : toConsolidate[members[0]];
      const brand = typeof group.brand === "string" && group.brand.trim() ? group.brand.trim() : name;
      for (const i of members) groups.set(toConsolidate[i].toLowerCase(), { name, brand });
    }
  } catch {
    // Fall back to exact-name grouping (already in `groups`).
  }
  return groups;
}

function aggregate(
  mentions: MentionIndex["mentions"],
  keyOf: (m: MentionIndex["mentions"][number]) => string,
  brandOf: (m: MentionIndex["mentions"][number]) => string
): LeaderboardEntry[] {
  // Per entity, the best (lowest) position it held in each answer - a chain listed twice in one answer
  // counts once, at its first place.
  const byKey = new Map<string, { name: string; brand: string; positions: Map<number, number> }>();
  for (const m of mentions) {
    const name = keyOf(m);
    const key = name.toLowerCase();
    let entry = byKey.get(key);
    if (!entry) {
      entry = { name, brand: brandOf(m), positions: new Map() };
      byKey.set(key, entry);
    }
    const prev = entry.positions.get(m.index);
    if (prev === undefined || m.position < prev) entry.positions.set(m.index, m.position);
  }
  const entries = Array.from(byKey.values()).map(({ name, brand, positions }): LeaderboardEntry => {
    const values = Array.from(positions.values());
    return {
      name,
      brand,
      mentionCount: positions.size,
      mentionedInIndexes: Array.from(positions.keys()).sort((a, b) => a - b),
      firstCount: values.filter((p) => p === 1).length,
      avgPosition: values.length ? values.reduce((s, p) => s + p, 0) / values.length : null,
    };
  });
  entries.sort(
    (a, b) => b.mentionCount - a.mentionCount || b.firstCount - a.firstCount || (a.avgPosition ?? 99) - (b.avgPosition ?? 99)
  );
  return entries;
}

/** Leaderboard over the given prompts (e.g. one location's), from a run-wide mention index. */
export function buildLeaderboard(index: MentionIndex, results: PromptResult[]): Leaderboard {
  const usable = results.filter((r) => !r.error && r.response.trim());
  const include = new Set(usable.map((r) => r.index));
  const mentions = index.mentions.filter((m) => include.has(m.index));
  return {
    entries: aggregate(mentions, (m) => m.business, (m) => m.brand),
    brands: aggregate(mentions, (m) => m.brand, (m) => m.brand),
    totalPromptsAnalyzed: usable.length,
  };
}

/** Best-effort index for mock mode: no extra model calls, just reads the "1. Name - blurb" lines mock answers use. */
function mockIndex(usable: PromptResult[]): MentionIndex {
  const mentions: MentionIndex["mentions"] = [];
  for (const r of usable) {
    let position = 0;
    for (const match of r.response.matchAll(/^\d+\.\s+(.+?)\s+-\s/gm)) {
      const name = match[1].trim();
      mentions.push({ business: name, brand: name.split(" ")[0], index: r.index, position: ++position });
    }
  }
  return { mentions };
}

/** Finds the rank (1-based) of the user's brand within a leaderboard, matching by name/alias. */
export function findBrandRank(leaderboard: Leaderboard, brandTerms: string[]): number | null {
  const index = leaderboard.entries.findIndex((entry) => matchesBrand(entry.name, brandTerms));
  return index === -1 ? null : index + 1;
}
