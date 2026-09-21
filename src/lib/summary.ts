import type { AnalysisSummary, PromptResult } from "./types";

export function buildSummary(
  brand: string,
  competitors: string[],
  results: PromptResult[],
  model: string,
  mock: boolean
): AnalysisSummary {
  const total = results.length;
  const failed = results.filter((r) => r.error).length;
  const completed = total - failed;

  const brandMentionCount = results.filter((r) => r.brandMentioned).length;
  const brandTotalOccurrences = results.reduce((sum, r) => sum + r.brandCount, 0);

  const competitorSummaries = competitors.map((name) => {
    const mentionCount = results.filter((r) => (r.competitorCounts[name] ?? 0) > 0).length;
    const totalOccurrences = results.reduce((sum, r) => sum + (r.competitorCounts[name] ?? 0), 0);
    return {
      name,
      mentionCount,
      totalOccurrences,
      mentionRate: completed > 0 ? mentionCount / completed : 0,
    };
  });

  return {
    totalPrompts: total,
    completed,
    failed,
    brand,
    brandMentionCount,
    brandTotalOccurrences,
    brandMentionRate: completed > 0 ? brandMentionCount / completed : 0,
    competitors: competitorSummaries,
    model,
    mock,
  };
}
