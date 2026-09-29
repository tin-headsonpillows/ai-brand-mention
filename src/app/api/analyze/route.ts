import type { NextRequest } from "next/server";
import { DEFAULT_MODEL, isMockMode } from "@/lib/openai";
import { generateVariations } from "@/lib/variations";
import { askChatGPT } from "@/lib/execute";
import { mockChatResponse } from "@/lib/mock";
import { countMentions, countMentionsAny, splitList } from "@/lib/mentions";
import { runWithConcurrency } from "@/lib/concurrency";
import { buildSummary } from "@/lib/summary";
import { buildLeaderboard, findBrandRank, indexMentions } from "@/lib/leaderboard";
import { fetchLocalResults, isSerpConfigured, mockLocalResults } from "@/lib/serpapi";
import { compareAiAndSerp } from "@/lib/compare";
import { cleanLocations, regionalPrompt, splitCount } from "@/lib/locations";
import type {
  AnalysisMode,
  AnalyzeRequestBody,
  Leaderboard,
  PromptResult,
  RegionReport,
  SerpComparison,
  StreamEvent,
} from "@/lib/types";

export const maxDuration = 300;

const MAX_VARIATIONS = 100;
const MIN_VARIATIONS = 5;
const CONCURRENCY = 8;
const SERP_CONCURRENCY = 3;

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return max;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function POST(req: NextRequest) {
  let body: AnalyzeRequestBody;
  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode: AnalysisMode = body.mode === "brand" ? "brand" : "market";
  const seedPrompt = (body.seedPrompt ?? "").trim();
  const brand = mode === "brand" ? (body.brand ?? "").trim() : "";
  if (!seedPrompt) return Response.json({ error: "seedPrompt is required" }, { status: 400 });
  if (mode === "brand" && !brand) return Response.json({ error: "brand is required in brand mode" }, { status: 400 });

  const brandTerms = brand ? [brand, ...splitList(body.brandAliases)] : [];
  const competitors = mode === "brand" ? splitList(body.competitors) : [];
  const locations = cleanLocations(body.locations);
  // One segment per location; a run without locations is a single unsegmented segment ("").
  const segments = locations.length > 0 ? locations : [""];
  const variationCount = clamp(body.variationCount ?? MAX_VARIATIONS, MIN_VARIATIONS, MAX_VARIATIONS);
  const perSegment = splitCount(variationCount, segments.length);
  const model = body.model?.trim() || DEFAULT_MODEL;
  const openaiApiKey = body.openaiApiKey?.trim() || undefined;
  const serpApiKey = body.serpApiKey?.trim() || undefined;
  const mock = isMockMode(openaiApiKey);
  const compareLocal = Boolean(body.compareLocal) && locations.length > 0;
  const localQueryTemplate = body.localSearchQuery?.trim() || seedPrompt;

  const encoder = new TextEncoder();
  let aborted = false;
  req.signal.addEventListener("abort", () => {
    aborted = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // controller already closed (client disconnected); ignore.
        }
      };

      try {
        const total = perSegment.reduce((a, b) => a + b, 0);
        send({
          type: "status",
          stage: "generating",
          message: mock
            ? "Mock mode (no OpenAI API key provided) - generating simulated prompt variations..."
            : locations.length > 1
              ? `Asking ChatGPT to generate ${total} similar prompts across ${locations.length} locations...`
              : `Asking ChatGPT to generate ${total} similar prompts...`,
        });

        const perLocation = await Promise.all(
          segments.map((location, i) =>
            generateVariations(
              regionalPrompt(seedPrompt, location, locations),
              perSegment[i],
              model,
              mock,
              openaiApiKey,
              location || undefined
            )
          )
        );
        if (aborted) return;
        const jobs = perLocation.flatMap((prompts, i) => prompts.map((prompt) => ({ prompt, location: segments[i] })));
        send({ type: "variations", variations: jobs.map((j) => j.prompt) });

        send({
          type: "status",
          stage: "executing",
          message: mock
            ? "Simulating ChatGPT responses (mock mode)..."
            : `Sending ${jobs.length} prompts to ChatGPT...`,
        });

        const results: PromptResult[] = [];
        let completed = 0;

        await runWithConcurrency(
          jobs,
          CONCURRENCY,
          async ({ prompt, location }, index): Promise<PromptResult> => {
            try {
              const response = mock
                ? mockChatResponse(prompt, brand, competitors, index, location)
                : await askChatGPT(prompt, model, openaiApiKey);
              const brandCount = brandTerms.length ? countMentionsAny(response, brandTerms) : 0;
              const competitorCounts: Record<string, number> = {};
              for (const name of competitors) {
                competitorCounts[name] = countMentions(response, name);
              }
              return { index, prompt, response, brandMentioned: brandCount > 0, brandCount, competitorCounts, location };
            } catch (err) {
              return {
                index,
                prompt,
                response: "",
                brandMentioned: false,
                brandCount: 0,
                competitorCounts: {},
                location,
                error: err instanceof Error ? err.message : "Unknown error",
              };
            }
          },
          (result) => {
            results.push(result);
            completed++;
            send({ type: "result", result, completed, total: jobs.length });
          },
          () => aborted
        );

        if (aborted) return;
        results.sort((a, b) => a.index - b.index);
        send({ type: "summary", summary: buildSummary(brand, competitors, results, model, mock, mode, locations) });

        send({
          type: "status",
          stage: "aggregating",
          message: mock
            ? "Building the business leaderboards (mock mode)..."
            : "Re-reading responses to find every business mentioned...",
        });
        const index = await indexMentions(results, model, mock, openaiApiKey);
        if (aborted) return;
        const leaderboard = buildLeaderboard(index, results);
        const regions: RegionReport[] = locations.map((location) => {
          const inRegion = results.filter((r) => r.location === location);
          const answered = inRegion.filter((r) => !r.error).length;
          const regionBoard = buildLeaderboard(index, inRegion);
          const brandMentionCount = inRegion.filter((r) => r.brandMentioned).length;
          return {
            location,
            leaderboard: regionBoard,
            brandMentionCount,
            brandMentionRate: answered > 0 ? brandMentionCount / answered : 0,
            brandRank: brandTerms.length ? findBrandRank(regionBoard, brandTerms) : null,
          };
        });
        send({
          type: "leaderboard",
          leaderboard,
          yourBrandRank: brandTerms.length ? findBrandRank(leaderboard, brandTerms) : null,
          regions,
        });

        if (compareLocal) {
          send({
            type: "status",
            stage: "serp",
            message: isSerpConfigured(serpApiKey)
              ? "Fetching Google local & maps results for comparison..."
              : "Simulating local search results (no SerpApi key provided)...",
          });
          await runWithConcurrency(
            regions,
            SERP_CONCURRENCY,
            async (region): Promise<{ comparison: SerpComparison } | { error: string }> => {
              const query = regionalPrompt(localQueryTemplate, region.location, locations);
              try {
                return { comparison: await buildSerpComparison(region.leaderboard, query, region.location, serpApiKey) };
              } catch (err) {
                return { error: `${region.location}: ${err instanceof Error ? err.message : "Unknown error"}` };
              }
            },
            (outcome) => {
              if ("comparison" in outcome) send({ type: "serp", comparison: outcome.comparison });
              else send({ type: "error", message: `Local search comparison failed for ${outcome.error}` });
            },
            () => aborted
          );
        }
        send({ type: "status", stage: "done", message: "Done." });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Unexpected error" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      aborted = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function buildSerpComparison(
  leaderboard: Leaderboard,
  query: string,
  location: string,
  apiKey?: string
): Promise<SerpComparison> {
  const configured = isSerpConfigured(apiKey);
  const localResults = configured ? await fetchLocalResults(query, apiKey) : mockLocalResults();
  const rows = compareAiAndSerp(leaderboard.entries, localResults);
  return { configured, mock: !configured, location, query, rows };
}
