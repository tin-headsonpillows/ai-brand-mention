export interface AnalyzeRequestBody {
  seedPrompt: string;
  brand: string;
  brandAliases?: string;
  competitors?: string;
  variationCount?: number;
  model?: string;
  location?: string;
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
}

export interface LeaderboardEntry {
  name: string;
  mentionCount: number;
  mentionedInIndexes: number[];
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  totalPromptsAnalyzed: number;
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
  | { type: "status"; stage: "generating" | "executing" | "aggregating" | "serp"; message: string }
  | { type: "variations"; variations: string[] }
  | { type: "result"; result: PromptResult; completed: number; total: number }
  | { type: "summary"; summary: AnalysisSummary }
  | { type: "leaderboard"; leaderboard: Leaderboard; yourBrandRank: number | null }
  | { type: "serp"; comparison: SerpComparison }
  | { type: "error"; message: string };
