"use client";

import { useCallback, useRef, useState } from "react";
import { AnalyzeForm } from "@/components/AnalyzeForm";
import { ProgressBar } from "@/components/ProgressBar";
import { StatTile } from "@/components/StatTile";
import { MentionRateChart, type MentionRateRow } from "@/components/MentionRateChart";
import { ResponseExplorer } from "@/components/ResponseExplorer";
import { BusinessLeaderboard } from "@/components/BusinessLeaderboard";
import { SerpComparisonView } from "@/components/SerpComparisonView";
import { RegionLeaders } from "@/components/RegionLeaders";
import { RegionMatrix } from "@/components/RegionMatrix";
import { Segmented } from "@/components/tracking/ui";
import type {
  AnalysisMode,
  AnalysisSummary,
  AnalyzeRequestBody,
  Leaderboard,
  PromptResult,
  RegionReport,
  SerpComparison,
  StreamEvent,
} from "@/lib/types";
import { splitList } from "@/lib/mentions";

interface RunState {
  running: boolean;
  statusMessage: string | null;
  total: number;
  completed: number;
  results: PromptResult[];
  summary: AnalysisSummary | null;
  leaderboard: Leaderboard | null;
  yourBrandRank: number | null;
  regions: RegionReport[];
  serpComparisons: SerpComparison[];
  error: string | null;
  mode: AnalysisMode;
  brand: string;
  brandTerms: string[];
  competitors: string[];
  locations: string[];
}

const initialState: RunState = {
  running: false,
  statusMessage: null,
  total: 0,
  completed: 0,
  results: [],
  summary: null,
  leaderboard: null,
  yourBrandRank: null,
  regions: [],
  serpComparisons: [],
  error: null,
  mode: "market",
  brand: "",
  brandTerms: [],
  competitors: [],
  locations: [],
};

export function ChatGptTab() {
  const [state, setState] = useState<RunState>(initialState);
  const [serpLocation, setSerpLocation] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSubmit = useCallback(async (body: AnalyzeRequestBody) => {
    const controller = new AbortController();
    abortRef.current = controller;

    const brand = body.brand?.trim() ?? "";
    setState({
      ...initialState,
      running: true,
      statusMessage: "Starting...",
      mode: body.mode ?? "market",
      brand,
      brandTerms: brand ? [brand, ...splitList(body.brandAliases)] : [],
      competitors: splitList(body.competitors),
      locations: body.locations ?? [],
    });
    setSerpLocation("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed with status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          applyEvent(event);
        }
      }
      if (buffer.trim()) {
        applyEvent(JSON.parse(buffer) as StreamEvent);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState((s) => ({ ...s, running: false, statusMessage: "Stopped." }));
      } else {
        setState((s) => ({
          ...s,
          running: false,
          error: err instanceof Error ? err.message : "Unexpected error",
        }));
      }
      return;
    }

    setState((s) => ({ ...s, running: false }));

    function applyEvent(event: StreamEvent) {
      setState((s) => {
        switch (event.type) {
          case "status":
            return { ...s, statusMessage: event.message };
          case "variations":
            return { ...s, total: event.variations.length, statusMessage: "Sending prompts to ChatGPT..." };
          case "result":
            return {
              ...s,
              results: [...s.results, event.result].sort((a, b) => a.index - b.index),
              completed: event.completed,
              total: event.total,
            };
          case "summary":
            return { ...s, summary: event.summary };
          case "leaderboard":
            return { ...s, leaderboard: event.leaderboard, yourBrandRank: event.yourBrandRank, regions: event.regions };
          case "serp":
            return {
              ...s,
              serpComparisons: [...s.serpComparisons, event.comparison].sort(
                (a, b) => s.locations.indexOf(a.location) - s.locations.indexOf(b.location)
              ),
            };
          case "error":
            return { ...s, error: event.message };
          default:
            return s;
        }
      });
    }
  }, []);

  const summary = state.summary;
  const brandMode = state.mode === "brand";
  const mentionRows: MentionRateRow[] =
    summary && brandMode
      ? [
          {
            name: summary.brand,
            mentionRate: summary.brandMentionRate,
            mentionCount: summary.brandMentionCount,
            totalOccurrences: summary.brandTotalOccurrences,
            isBrand: true,
          },
          ...summary.competitors.map((c) => ({
            name: c.name,
            mentionRate: c.mentionRate,
            mentionCount: c.mentionCount,
            totalOccurrences: c.totalOccurrences,
            isBrand: false,
          })),
        ]
      : [];
  const multiRegion = state.regions.length > 1;
  const activeSerp =
    state.serpComparisons.find((c) => c.location === serpLocation) ?? state.serpComparisons[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          ChatGPT Mentions
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Enter a question your customers might ask ChatGPT and the locations you care about. We generate realistic
          variations for each location, run them all through the ChatGPT API, and rank which businesses it recommends
          most - or how often your own brand makes the list.
        </p>
      </header>

      <AnalyzeForm running={state.running} onSubmit={handleSubmit} onStop={handleStop} />

      {state.error ? (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}
        >
          {state.error}
        </div>
      ) : null}

      {state.running || state.statusMessage ? (
        <div className="flex flex-col gap-3">
          {state.statusMessage ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {state.statusMessage}
            </p>
          ) : null}
          {state.total > 0 ? <ProgressBar completed={state.completed} total={state.total} /> : null}
        </div>
      ) : null}

      {summary ? (
        brandMode ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile
                label="Brand mention rate"
                value={`${Math.round(summary.brandMentionRate * 100)}%`}
                sublabel={`${summary.brandMentionCount} of ${summary.completed} prompts`}
              />
              <StatTile
                label="Prompts run"
                value={String(summary.totalPrompts)}
                sublabel={
                  summary.locations.length > 1 ? `${summary.locations.length} locations · ${summary.model}` : summary.model
                }
              />
              <StatTile label="Total mentions" value={String(summary.brandTotalOccurrences)} sublabel="across all responses" />
              <StatTile
                label="Failed calls"
                value={String(summary.failed)}
                sublabel={summary.mock ? "mock mode" : "API errors"}
              />
            </div>
            {mentionRows.length > 1 ? <MentionRateChart rows={mentionRows} completed={summary.completed} /> : null}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile
              label="Locations"
              value={String(Math.max(1, summary.locations.length))}
              sublabel={summary.locations.length ? summary.locations.join(", ") : "not split by location"}
            />
            <StatTile label="Prompts run" value={String(summary.totalPrompts)} sublabel={summary.model} />
            <StatTile
              label="Businesses found"
              value={state.leaderboard ? String(state.leaderboard.entries.length) : "…"}
              sublabel={state.leaderboard ? `${state.leaderboard.brands.length} brands` : "extracting"}
            />
            <StatTile
              label="Failed calls"
              value={String(summary.failed)}
              sublabel={summary.mock ? "mock mode" : "API errors"}
            />
          </div>
        )
      ) : null}

      {state.regions.length > 0 ? (
        <RegionLeaders regions={state.regions} brandTerms={state.brandTerms} brandMode={brandMode} />
      ) : null}

      {multiRegion && state.leaderboard && state.leaderboard.entries.length > 0 ? (
        <RegionMatrix regions={state.regions} overall={state.leaderboard} brandTerms={state.brandTerms} />
      ) : null}

      {state.leaderboard ? (
        <BusinessLeaderboard
          leaderboard={state.leaderboard}
          brandTerms={state.brandTerms}
          scope={multiRegion ? `all ${state.regions.length} locations` : state.regions[0]?.location}
        />
      ) : null}

      {activeSerp ? (
        <div className="flex flex-col gap-2">
          {state.serpComparisons.length > 1 ? (
            <Segmented
              value={activeSerp.location}
              options={state.serpComparisons.map((c) => ({ value: c.location, label: c.location }))}
              onChange={setSerpLocation}
              ariaLabel="Local comparison location"
            />
          ) : null}
          <SerpComparisonView comparison={activeSerp} />
        </div>
      ) : null}

      {state.results.length > 0 ? (
        <ResponseExplorer
          results={state.results}
          brand={brandMode ? state.brand : ""}
          competitors={state.competitors}
          locations={state.locations}
        />
      ) : null}
    </div>
  );
}
