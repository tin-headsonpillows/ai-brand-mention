/**
 * "market" ranks every business ChatGPT recommends (segmented by location); "brand" measures how often
 * one brand gets recommended, alongside the same per-location breakdown.
 */
export type AnalysisMode = "market" | "brand";

export interface AnalyzeRequestBody {
  mode?: AnalysisMode;
  seedPrompt: string;
  /** Required in brand mode only. */
  brand?: string;
  brandAliases?: string;
  competitors?: string;
  /** Total prompts for the run, split evenly across the locations. */
  variationCount?: number;
  model?: string;
  /** Each location gets its own set of prompts and its own leaderboard. */
  locations?: string[];
  /** Also pull Google Local & Maps results for each location to compare against. */
  compareLocal?: boolean;
  localSearchQuery?: string;
  /** Bring-your-own key: used only for this request, never logged or persisted server-side. */
  openaiApiKey?: string;
  /** Bring-your-own key: used only for this request, never logged or persisted server-side. */
  serpApiKey?: string;
}

export interface PromptResult {
  index: number;
  prompt: string;
  response: string;
  brandMentioned: boolean;
  brandCount: number;
  competitorCounts: Record<string, number>;
  /** The location this prompt was generated for ("" when the run isn't split by location). */
  location: string;
  error?: string;
}

export interface CompetitorSummary {
  name: string;
  mentionCount: number;
  totalOccurrences: number;
  mentionRate: number;
}

export interface AnalysisSummary {
  totalPrompts: number;
  completed: number;
  failed: number;
  brand: string;
  brandMentionCount: number;
  brandTotalOccurrences: number;
  brandMentionRate: number;
  competitors: CompetitorSummary[];
  model: string;
  mock: boolean;
  mode: AnalysisMode;
  locations: string[];
}

export interface LeaderboardEntry {
  name: string;
  /** Parent brand / chain (e.g. "Vinpearl"), or the business's own name when it's independent. */
  brand: string;
  /** Distinct prompts whose answer mentioned it. */
  mentionCount: number;
  mentionedInIndexes: number[];
  /** Answers that listed it first. */
  firstCount: number;
  /** Average 1-based position among the businesses each answer listed. */
  avgPosition: number | null;
}

export interface Leaderboard {
  /** One row per business/property. */
  entries: LeaderboardEntry[];
  /** The same mentions rolled up to parent brand / chain. */
  brands: LeaderboardEntry[];
  totalPromptsAnalyzed: number;
}

export interface RegionReport {
  location: string;
  leaderboard: Leaderboard;
  /** Brand mode only: prompts in this location whose answer mentioned the brand. */
  brandMentionCount: number;
  brandMentionRate: number;
  brandRank: number | null;
}

export interface SerpLocalResult {
  name: string;
  rating: number | null;
  reviews: number | null;
  address: string | null;
  position: number | null;
  source: "google_local" | "google_maps";
}

export type MatchCategory = "both" | "ai_only" | "serp_only";

export interface ComparisonRow {
  name: string;
  aiMentionCount: number | null;
  serpRating: number | null;
  serpReviews: number | null;
  serpPosition: number | null;
  category: MatchCategory;
}

export interface SerpComparison {
  configured: boolean;
  mock: boolean;
  location: string;
  query: string;
  rows: ComparisonRow[];
}

export type StreamEvent =
  | { type: "status"; stage: "generating" | "executing" | "aggregating" | "serp" | "done"; message: string }
  | { type: "variations"; variations: string[] }
  | { type: "result"; result: PromptResult; completed: number; total: number }
  | { type: "summary"; summary: AnalysisSummary }
  | { type: "leaderboard"; leaderboard: Leaderboard; yourBrandRank: number | null; regions: RegionReport[] }
  | { type: "serp"; comparison: SerpComparison }
  | { type: "error"; message: string };
