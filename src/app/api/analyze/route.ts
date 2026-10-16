import type { NextRequest } from "next/server";
import { isMockMode } from "@/lib/openai";
import { estimateRun, fmtUsd } from "@/lib/chatgpt/pricing";
import { BudgetExceeded, identifyKey, limitFor, readSettings, serverDefaultModel, startMeter, type UsageMeter } from "@/lib/chatgpt/usage";
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
  RunCost,
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
  const settings = await readSettings();
  const model = body.model?.trim() || settings.model || serverDefaultModel();
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

      const total = perSegment.reduce((a, b) => a + b, 0);
      const estimateUsd = estimateRun(model, total, segments.length).totalUsd;
      let meter: UsageMeter | null = null;
      let budgetHit = false;
      const mockKey = identifyKey(openaiApiKey);
      const sendCost = (final: boolean) =>
        send({
          type: "cost",
          cost: {
            model,
            mock,
            estimateUsd,
            actualUsd: meter?.run.costUsd ?? 0,
            calls: meter?.run.calls ?? 0,
            inputTokens: meter?.run.input ?? 0,
            outputTokens: meter?.run.output ?? 0,
            keyLabel: meter?.keyLabel ?? mockKey.label,
            spentTodayUsd: meter?.spentToday ?? 0,
            limitUsd: meter?.limitUsd ?? limitFor(settings, mockKey.id),
            final,
            budgetHit,
          } satisfies RunCost,
        });

      try {
        if (!mock) {
          meter = (await startMeter(openaiApiKey)).meter;
          const left = Math.max(0, meter.limitUsd - meter.spentBefore);
          if (estimateUsd > left) {
            send({
              type: "error",
              message: `This run is estimated at ${fmtUsd(estimateUsd)}, but only ${fmtUsd(left)} is left today of the ${fmtUsd(meter.limitUsd)} daily limit for ${meter.keyLabel}. Run fewer prompts, choose a cheaper model, or raise the limit in Settings.`,
            });
            return;
          }
        }
        sendCost(false);
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
              location || undefined,
              meter ?? undefined
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
          async ({ prompt, location }, index): Promise<PromptResult | null> => {
            // Once the daily limit is reached, prompts not yet sent are skipped; answers already paid for still count.
            if (budgetHit) return null;
            try {
              const response = mock
                ? mockChatResponse(prompt, brand, competitors, index, location)
                : await askChatGPT(prompt, model, openaiApiKey, meter ?? undefined);
              const brandCount = brandTerms.length ? countMentionsAny(response, brandTerms) : 0;
              const competitorCounts: Record<string, number> = {};
              for (const name of competitors) {
                competitorCounts[name] = countMentions(response, name);
              }
              return { index, prompt, response, brandMentioned: brandCount > 0, brandCount, competitorCounts, location };
            } catch (err) {
              if (err instanceof BudgetExceeded) {
                budgetHit = true;
                return null;
              }
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
            if (!result) return;
            results.push(result);
            completed++;
            send({ type: "result", result, completed, total: jobs.length });
            if (completed % 10 === 0) sendCost(false);
          },
          () => aborted
        );

        if (aborted) return;
        results.sort((a, b) => a.index - b.index);
        send({ type: "summary", summary: buildSummary(brand, competitors, results, model, mock, mode, locations) });
        if (budgetHit && meter) {
          send({
            type: "error",
            message: `Stopped after ${results.filter((r) => !r.error).length} answers: the daily limit for ${meter.keyLabel} (${fmtUsd(meter.limitUsd)}) was reached. The leaderboard and local comparison were skipped.`,
          });
          send({ type: "status", stage: "done", message: "Stopped at the daily limit." });
          return;
        }

        send({
          type: "status",
          stage: "aggregating",
          message: mock
            ? "Building the business leaderboards (mock mode)..."
            : "Re-reading responses to find every business mentioned...",
        });
        const index = await indexMentions(results, model, mock, openaiApiKey, meter ?? undefined);
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
        if (err instanceof BudgetExceeded) budgetHit = true;
        send({ type: "error", message: err instanceof Error ? err.message : "Unexpected error" });
      } finally {
        // Record the run's usage even when it stopped early.
        if (meter) await meter.flush(meter.run.calls > 0);
        sendCost(true);
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
