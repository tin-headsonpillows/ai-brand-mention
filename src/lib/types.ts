export interface AnalyzeRequestBody {
  seedPrompt: string;
  brand: string;
  brandAliases?: string;
  competitors?: string;
  variationCount?: number;
  model?: string;
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

export type StreamEvent =
  | { type: "status"; stage: "generating" | "executing"; message: string }
  | { type: "variations"; variations: string[] }
  | { type: "result"; result: PromptResult; completed: number; total: number }
  | { type: "summary"; summary: AnalysisSummary }
  | { type: "error"; message: string };
