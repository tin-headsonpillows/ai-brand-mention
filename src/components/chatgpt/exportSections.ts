import type { ExportSection, ExportTable } from "@/lib/export/types";
import type { AnalysisSummary, ComparisonRow, Leaderboard, LeaderboardEntry, PromptResult, RegionReport, RunCost, SerpComparison } from "@/lib/types";
import type { MentionRateRow } from "@/components/MentionRateChart";

/** Turns each ChatGPT Mentions section's data into an export section (tables, facts, charts). */

const share = (count: number, total: number) => (total > 0 ? count / total : 0);

function entryTable(name: string, list: LeaderboardEntry[], total: number, withBrand: boolean, limit?: number): ExportTable {
  return {
    name,
    columns: [
      { header: "#", format: "int", width: 6 },
      { header: withBrand ? "Business" : "Brand / chain", width: 40 },
      ...(withBrand ? [{ header: "Brand / chain", width: 24 }] : []),
      { header: "Answers mentioning", format: "int" as const },
      { header: "Share of answers", format: "pct" as const },
      { header: "Listed first", format: "int" as const },
      { header: "Avg. position", format: "decimal" as const },
    ],
    rows: (limit ? list.slice(0, limit) : list).map((e, i) => [
      i + 1,
      e.name,
      ...(withBrand ? [e.brand] : []),
      e.mentionCount,
      share(e.mentionCount, total),
      e.firstCount,
      e.avgPosition,
    ]),
  };
}

export function overviewSection(input: {
  prompt: string;
  mode: "market" | "brand";
  summary: AnalysisSummary | null;
  leaderboard: Leaderboard | null;
  cost: RunCost | null;
  brandRank: number | null;
}): ExportSection {
  const { summary, leaderboard, cost } = input;
  const facts: Array<[string, string]> = [
    ["Prompt", input.prompt],
    ["Mode", input.mode === "brand" ? "Brand awareness" : "Regional market"],
    ["Locations", summary?.locations.length ? summary.locations.join(", ") : "Not split by location"],
    ["Model", summary?.model ?? cost?.model ?? "–"],
    ["Prompts run", summary ? `${summary.totalPrompts} (${summary.completed} answered, ${summary.failed} failed)` : "–"],
  ];
  if (leaderboard) facts.push(["Businesses found", `${leaderboard.entries.length} (${leaderboard.brands.length} brands)`]);
  if (input.mode === "brand" && summary) {
    facts.push(["Brand", summary.brand]);
    facts.push(["Brand mention rate", `${Math.round(summary.brandMentionRate * 100)}% (${summary.brandMentionCount} of ${summary.completed} answers)`]);
    if (input.brandRank) facts.push(["Brand rank in the leaderboard", `#${input.brandRank}`]);
  }
  if (cost) facts.push(["Run cost", cost.mock ? `simulated run (about $${cost.estimateUsd.toFixed(4)} with a real key)` : `$${cost.actualUsd.toFixed(4)} (estimated $${cost.estimateUsd.toFixed(4)}; ${cost.calls} API calls)`]);
  if (summary?.mock) facts.push(["Note", "Simulated answers (no OpenAI key) - for testing only"]);
  const top = leaderboard?.entries.slice(0, 10) ?? [];
  return {
    title: "Run overview",
    facts,
    charts: top.length
      ? [{ title: "Most recommended businesses", categories: top.map((e) => e.name), series: [{ name: "Share of answers", values: top.map((e) => share(e.mentionCount, leaderboard?.totalPromptsAnalyzed ?? 0)) }], format: "pct" }]
      : [],
    tables: leaderboard ? [entryTable("Top 10 businesses", leaderboard.entries, leaderboard.totalPromptsAnalyzed, true, 10)] : [],
  };
}

export function mentionRateSection(rows: MentionRateRow[], completed: number): ExportSection {
  const sorted = [...rows].sort((a, b) => b.mentionRate - a.mentionRate);
  return {
    title: "Mention rate by brand",
    subtitle: `Share of ${completed} answered prompts that mention each brand`,
    charts: [{ title: "Mention rate by brand", categories: sorted.map((r) => r.name), series: [{ name: "Mention rate", values: sorted.map((r) => r.mentionRate) }], format: "pct" }],
    tables: [
      {
        name: "Mention rate",
        columns: [{ header: "Brand", width: 34 }, { header: "Your brand" }, { header: "Answers mentioning", format: "int" }, { header: "Mention rate", format: "pct" }, { header: "Total mentions", format: "int" }],
        rows: sorted.map((r) => [r.name, r.isBrand ? "Yes" : "No", r.mentionCount, r.mentionRate, r.totalOccurrences]),
      },
    ],
  };
}

export function regionLeadersSection(regions: RegionReport[], brandMode: boolean): ExportSection {
  return {
    title: "Top recommendations by location",
    subtitle: "Share of each location's answers that mention the business or brand",
    charts: regions.slice(0, 8).map((r) => {
      const top = r.leaderboard.entries.slice(0, 10);
      return { title: `${r.location}: most recommended`, categories: top.map((e) => e.name), series: [{ name: "Share of answers", values: top.map((e) => share(e.mentionCount, r.leaderboard.totalPromptsAnalyzed)) }], format: "pct" as const };
    }),
    tables: [
      {
        name: "Locations",
        columns: [
          { header: "Location", width: 24 },
          { header: "Answers", format: "int" },
          { header: "Most recommended", width: 36 },
          { header: "Its share", format: "pct" },
          ...(brandMode ? [{ header: "Brand mention rate", format: "pct" as const }, { header: "Brand rank", format: "int" as const }] : []),
        ],
        rows: regions.map((r) => {
          const lead = r.leaderboard.entries[0];
          return [
            r.location,
            r.leaderboard.totalPromptsAnalyzed,
            lead?.name ?? null,
            lead ? share(lead.mentionCount, r.leaderboard.totalPromptsAnalyzed) : null,
            ...(brandMode ? [r.brandMentionRate, r.brandRank] : []),
          ];
        }),
      },
      ...regions.flatMap((r) => [
        entryTable(`${r.location} - businesses`, r.leaderboard.entries, r.leaderboard.totalPromptsAnalyzed, true, 30),
        entryTable(`${r.location} - brands`, r.leaderboard.brands, r.leaderboard.totalPromptsAnalyzed, false, 30),
      ]),
    ],
  };
}

export function regionMatrixSection(regions: RegionReport[], overall: Leaderboard): ExportSection {
  const matrix = (level: "brand" | "business"): ExportTable => {
    const rows = (level === "brand" ? overall.brands : overall.entries).slice(0, 40);
    const lookups = regions.map((r) => new Map((level === "brand" ? r.leaderboard.brands : r.leaderboard.entries).map((e) => [e.name.toLowerCase(), share(e.mentionCount, r.leaderboard.totalPromptsAnalyzed)])));
    return {
      name: level === "brand" ? "Brands by location" : "Businesses by location",
      columns: [{ header: level === "brand" ? "Brand / chain" : "Business", width: 36 }, ...regions.map((r) => ({ header: r.location, format: "pct" as const })), { header: "All locations", format: "pct" }],
      rows: rows.map((e) => [e.name, ...lookups.map((l) => l.get(e.name.toLowerCase()) ?? 0), share(e.mentionCount, overall.totalPromptsAnalyzed)]),
    };
  };
  return { title: "Who wins where", subtitle: "Share of each location's answers that mention the brand or business", tables: [matrix("brand"), matrix("business")] };
}

export function leaderboardSection(leaderboard: Leaderboard, scope?: string): ExportSection {
  const total = leaderboard.totalPromptsAnalyzed;
  const top = leaderboard.entries.slice(0, 15);
  return {
    title: scope ? `Leaderboard - ${scope}` : "Business leaderboard",
    subtitle: `${leaderboard.entries.length} businesses and ${leaderboard.brands.length} brands across ${total} answers`,
    charts: top.length ? [{ title: "Share of answers mentioning each business", categories: top.map((e) => e.name), series: [{ name: "Share of answers", values: top.map((e) => share(e.mentionCount, total)) }], format: "pct" }] : [],
    tables: [entryTable("Businesses", leaderboard.entries, total, true), entryTable("Brands", leaderboard.brands, total, false)],
  };
}

const CATEGORY: Record<ComparisonRow["category"], string> = { both: "Both", ai_only: "ChatGPT only", serp_only: "Google local only" };

export function serpSection(comparisons: SerpComparison[]): ExportSection {
  return {
    title: "ChatGPT vs. Google local results",
    subtitle: comparisons.some((c) => c.mock) ? "Includes simulated local results (no SerpApi key)" : "Businesses ChatGPT mentions against Google's local pack",
    tables: comparisons.map((c) => ({
      name: c.location || "Local results",
      note: `Google query: "${c.query}"`,
      columns: [{ header: "Business", width: 40 }, { header: "Found in", width: 18 }, { header: "ChatGPT mentions", format: "int" }, { header: "Google position", format: "int" }, { header: "Rating", format: "decimal" }, { header: "Reviews", format: "int" }],
      rows: c.rows.map((r) => [r.name, CATEGORY[r.category], r.aiMentionCount, r.serpPosition, r.serpRating, r.serpReviews]),
    })),
  };
}

export function responsesSection(results: PromptResult[], brand: string, competitors: string[]): ExportSection {
  return {
    title: "ChatGPT answers",
    subtitle: `${results.length} prompts and the answers ChatGPT gave`,
    tables: [
      {
        name: "Answers",
        columns: [
          { header: "#", format: "int", width: 6 },
          { header: "Location", width: 16 },
          { header: "Prompt", width: 40 },
          ...(brand ? [{ header: `${brand} mentions`, format: "int" as const }] : []),
          ...competitors.map((c) => ({ header: `${c} mentions`, format: "int" as const })),
          { header: "Answer", width: 90 },
          { header: "Error", width: 20 },
        ],
        rows: results.map((r) => [r.index + 1, r.location || null, r.prompt, ...(brand ? [r.brandCount] : []), ...competitors.map((c) => r.competitorCounts[c] ?? 0), r.response, r.error ?? null]),
      },
    ],
  };
}
