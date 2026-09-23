import type { ComparisonRow, LeaderboardEntry, SerpLocalResult } from "./types";

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Cross-references businesses ChatGPT mentioned against Google's local pack
 * (SerpApi), categorizing each as mentioned in both, AI-only, or SERP-only -
 * the same "gap signal" framing as manual GEO visibility audits.
 */
export function compareAiAndSerp(aiEntries: LeaderboardEntry[], serpResults: SerpLocalResult[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const usedSerp = new Set<number>();

  for (const entry of aiEntries) {
    const matchIndex = serpResults.findIndex((s, i) => !usedSerp.has(i) && namesMatch(entry.name, s.name));
    if (matchIndex === -1) {
      rows.push({
        name: entry.name,
        aiMentionCount: entry.mentionCount,
        serpRating: null,
        serpReviews: null,
        serpPosition: null,
        category: "ai_only",
      });
      continue;
    }
    usedSerp.add(matchIndex);
    const s = serpResults[matchIndex];
    rows.push({
      name: entry.name,
      aiMentionCount: entry.mentionCount,
      serpRating: s.rating,
      serpReviews: s.reviews,
      serpPosition: s.position,
      category: "both",
    });
  }

  serpResults.forEach((s, i) => {
    if (usedSerp.has(i)) return;
    rows.push({
      name: s.name,
      aiMentionCount: null,
      serpRating: s.rating,
      serpReviews: s.reviews,
      serpPosition: s.position,
      category: "serp_only",
    });
  });

  rows.sort((a, b) => {
    const byMentions = (b.aiMentionCount ?? 0) - (a.aiMentionCount ?? 0);
    if (byMentions !== 0) return byMentions;
    return (a.serpPosition ?? 99) - (b.serpPosition ?? 99);
  });
  return rows;
}
