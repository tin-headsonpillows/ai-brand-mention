import { createChatCompletion } from "./execute";
import type { Leaderboard, LeaderboardEntry, PromptResult } from "./types";

const CHUNK_SIZE = 20;

interface ChunkExtraction {
  businesses?: Array<{ name?: unknown; responseIndexes?: unknown }>;
}

interface ConsolidationResult {
  leaderboard?: Array<{ canonicalName?: unknown; mentionedIn?: unknown }>;
}

/**
 * Extracts every business/brand mentioned across all responses (not just the
 * user's brand and named competitors) and ranks them by how many distinct
 * prompts mentioned them. Uses the model itself for extraction since this is
 * open-ended entity recognition, not a fixed term to regex-match.
 */
export async function buildLeaderboard(
  results: PromptResult[],
  model: string,
  mock: boolean
): Promise<Leaderboard> {
  const usable = results.filter((r) => !r.error && r.response.trim());
  if (usable.length === 0) return { entries: [], totalPromptsAnalyzed: 0 };

  if (mock) return mockLeaderboard(usable);

  const chunks: PromptResult[][] = [];
  for (let i = 0; i < usable.length; i += CHUNK_SIZE) chunks.push(usable.slice(i, i + CHUNK_SIZE));

  const rawEntries: Array<{ name: string; indexes: number[] }> = [];

  for (const chunk of chunks) {
    const listing = chunk.map((r) => `[${r.index}] ${r.response}`).join("\n\n");
    let parsed: ChunkExtraction;
    try {
      const completion = await createChatCompletion({
        model,
        messages: [
          {
            role: "system",
            content:
              'You extract every distinct business/brand/place name that is recommended or mentioned as an option in a set of numbered AI assistant responses. Return ONLY JSON: {"businesses": [{"name": string, "responseIndexes": number[]}]}. Use each response\'s bracketed number as its index. Group re-mentions of the exact same business within this batch under one name, but never merge different businesses together.',
          },
          { role: "user", content: listing },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });
      parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as ChunkExtraction;
    } catch {
      continue; // skip a malformed/failed chunk rather than failing the whole leaderboard
    }
    for (const item of parsed.businesses ?? []) {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const indexes = Array.isArray(item.responseIndexes)
        ? item.responseIndexes.filter((n): n is number => typeof n === "number")
        : [];
      if (name && indexes.length > 0) rawEntries.push({ name, indexes });
    }
  }

  if (rawEntries.length === 0) return { entries: [], totalPromptsAnalyzed: usable.length };

  const entries = await consolidate(rawEntries, model);
  return { entries, totalPromptsAnalyzed: usable.length };
}

async function consolidate(
  rawEntries: Array<{ name: string; indexes: number[] }>,
  model: string
): Promise<LeaderboardEntry[]> {
  const listing = rawEntries.map((e, i) => `${i}. "${e.name}" -> responses [${e.indexes.join(", ")}]`).join("\n");

  try {
    const completion = await createChatCompletion({
      model,
      messages: [
        {
          role: "system",
          content:
            'You are deduplicating a list of business/brand mentions extracted from many AI responses. Several list entries may refer to the same real business under slightly different names or phrasing (e.g. "Furama Resort" and "Furama Resort Danang"). Merge those into one canonical entry, unioning their response index lists. Never merge genuinely different businesses. Return ONLY JSON: {"leaderboard": [{"canonicalName": string, "mentionedIn": number[]}]}.',
        },
        { role: "user", content: listing },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as ConsolidationResult;
    const list = parsed.leaderboard;
    if (!Array.isArray(list) || list.length === 0) return rawFallback(rawEntries);

    const entries: LeaderboardEntry[] = list
      .map((item) => {
        const name = typeof item.canonicalName === "string" ? item.canonicalName.trim() : "";
        const indexes = Array.isArray(item.mentionedIn)
          ? Array.from(new Set(item.mentionedIn.filter((n): n is number => typeof n === "number")))
          : [];
        return { name, mentionCount: indexes.length, mentionedInIndexes: indexes };
      })
      .filter((e) => e.name && e.mentionCount > 0);

    if (entries.length === 0) return rawFallback(rawEntries);
    entries.sort((a, b) => b.mentionCount - a.mentionCount);
    return entries;
  } catch {
    return rawFallback(rawEntries);
  }
}

function rawFallback(rawEntries: Array<{ name: string; indexes: number[] }>): LeaderboardEntry[] {
  const byKey = new Map<string, { name: string; indexes: Set<number> }>();
  for (const { name, indexes } of rawEntries) {
    const key = name.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      indexes.forEach((i) => existing.indexes.add(i));
    } else {
      byKey.set(key, { name, indexes: new Set(indexes) });
    }
  }
  const entries: LeaderboardEntry[] = Array.from(byKey.values()).map(({ name, indexes }) => ({
    name,
    mentionCount: indexes.size,
    mentionedInIndexes: Array.from(indexes),
  }));
  entries.sort((a, b) => b.mentionCount - a.mentionCount);
  return entries;
}

/** Best-effort leaderboard for mock mode: no extra model calls, just scans mock text for capitalized names. */
function mockLeaderboard(usable: PromptResult[]): Leaderboard {
  // Require at least two capitalized words in a row (e.g. "Furama Resort") to
  // avoid picking up ordinary sentence-starters ("Great", "Based", "Here").
  const namePattern = /\b(?:[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\b/g;
  const counts = new Map<string, Set<number>>();

  for (const r of usable) {
    const seenInThisResponse = new Set<string>();
    for (const match of r.response.matchAll(namePattern)) {
      const name = match[0].trim();
      if (name.length < 4 || seenInThisResponse.has(name)) continue;
      seenInThisResponse.add(name);
      const set = counts.get(name) ?? new Set<number>();
      set.add(r.index);
      counts.set(name, set);
    }
  }

  const entries: LeaderboardEntry[] = Array.from(counts.entries())
    .map(([name, set]) => ({ name, mentionCount: set.size, mentionedInIndexes: Array.from(set) }))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 15);

  return { entries, totalPromptsAnalyzed: usable.length };
}

/** Finds the rank (1-based) of the user's brand within a leaderboard, matching by name/alias. */
export function findBrandRank(leaderboard: Leaderboard, brandTerms: string[]): number | null {
  const normalizedTerms = brandTerms.map((t) => t.toLowerCase());
  const index = leaderboard.entries.findIndex((entry) => {
    const name = entry.name.toLowerCase();
    return normalizedTerms.some((term) => name.includes(term) || term.includes(name));
  });
  return index === -1 ? null : index + 1;
}
