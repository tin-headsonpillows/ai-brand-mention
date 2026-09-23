import type { NextRequest } from "next/server";
import { DEFAULT_MODEL, isMockMode } from "@/lib/openai";
import { generateVariations } from "@/lib/variations";
import { askChatGPT } from "@/lib/execute";
import { mockChatResponse } from "@/lib/mock";
import { countMentions, countMentionsAny, splitList } from "@/lib/mentions";
import { runWithConcurrency } from "@/lib/concurrency";
import { buildSummary } from "@/lib/summary";
import { buildLeaderboard, findBrandRank } from "@/lib/leaderboard";
import { fetchLocalResults, isSerpConfigured, mockLocalResults } from "@/lib/serpapi";
import { compareAiAndSerp } from "@/lib/compare";
import type { AnalyzeRequestBody, PromptResult, SerpComparison, StreamEvent } from "@/lib/types";

export const maxDuration = 300;

const MAX_VARIATIONS = 100;
const MIN_VARIATIONS = 5;
const CONCURRENCY = 8;

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

  const seedPrompt = (body.seedPrompt ?? "").trim();
  const brand = (body.brand ?? "").trim();
  if (!seedPrompt || !brand) {
    return Response.json({ error: "seedPrompt and brand are required" }, { status: 400 });
  }

  const brandTerms = [brand, ...splitList(body.brandAliases)];
  const competitors = splitList(body.competitors);
  const variationCount = clamp(body.variationCount ?? MAX_VARIATIONS, MIN_VARIATIONS, MAX_VARIATIONS);
  const model = body.model?.trim() || DEFAULT_MODEL;
  const mock = isMockMode();
  const location = body.location?.trim() || "";
  const localSearchQuery = body.localSearchQuery?.trim() || seedPrompt;

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
        send({
          type: "status",
          stage: "generating",
          message: mock
            ? "Mock mode (no OPENAI_API_KEY set) - generating simulated prompt variations..."
            : `Asking ChatGPT to generate ${variationCount} similar prompts...`,
        });

        const variations = await generateVariations(seedPrompt, variationCount, model, mock);
        if (aborted) return;
        send({ type: "variations", variations });

        send({
          type: "status",
          stage: "executing",
          message: mock
            ? "Simulating ChatGPT responses (mock mode)..."
            : `Sending ${variations.length} prompts to ChatGPT and counting mentions...`,
        });

        const results: PromptResult[] = [];
        let completed = 0;

        await runWithConcurrency(
          variations,
          CONCURRENCY,
          async (prompt, index): Promise<PromptResult> => {
            try {
              const response = mock
                ? mockChatResponse(prompt, brand, competitors, index)
                : await askChatGPT(prompt, model);
              const brandCount = countMentionsAny(response, brandTerms);
              const competitorCounts: Record<string, number> = {};
              for (const name of competitors) {
                competitorCounts[name] = countMentions(response, name);
              }
              return {
                index,
                prompt,
                response,
                brandMentioned: brandCount > 0,
                brandCount,
                competitorCounts,
              };
            } catch (err) {
              return {
                index,
                prompt,
                response: "",
                brandMentioned: false,
                brandCount: 0,
                competitorCounts: {},
                error: err instanceof Error ? err.message : "Unknown error",
              };
            }
          },
          (result) => {
            results.push(result);
            completed++;
            send({ type: "result", result, completed, total: variations.length });
          },
          () => aborted
        );

        if (aborted) return;
        results.sort((a, b) => a.index - b.index);
        const summary = buildSummary(brand, competitors, results, model, mock);
        send({ type: "summary", summary });

        send({
          type: "status",
          stage: "aggregating",
          message: mock
            ? "Building the business leaderboard (mock mode)..."
            : "Re-reading responses to find every business mentioned...",
        });
        const leaderboard = await buildLeaderboard(results, model, mock);
        if (aborted) return;
        const yourBrandRank = findBrandRank(leaderboard, brandTerms);
        send({ type: "leaderboard", leaderboard, yourBrandRank });

        if (location) {
          send({
            type: "status",
            stage: "serp",
            message: isSerpConfigured()
              ? "Fetching Google local & maps results for comparison..."
              : "Simulating local search results (SERPAPI_API_KEY not set)...",
          });
          try {
            const comparison = await buildSerpComparison(leaderboard, localSearchQuery, location);
            if (aborted) return;
            send({ type: "serp", comparison });
          } catch (err) {
            send({
              type: "error",
              message: `Local search comparison failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            });
          }
        }
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
  leaderboard: Awaited<ReturnType<typeof buildLeaderboard>>,
  query: string,
  location: string
): Promise<SerpComparison> {
  const configured = isSerpConfigured();
  const localResults = configured ? await fetchLocalResults(query, location) : mockLocalResults();
  const rows = compareAiAndSerp(leaderboard.entries, localResults);
  return { configured, mock: !configured, location, query, rows };
}
