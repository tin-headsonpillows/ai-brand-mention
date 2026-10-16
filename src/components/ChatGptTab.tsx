"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { SettingsView } from "@/components/chatgpt/SettingsView";
import { UsageView } from "@/components/chatgpt/UsageView";
import { useMentionsSettings } from "@/components/chatgpt/settings";
import { fmtUsd, modelLabel } from "@/lib/chatgpt/pricing";
import { readParam, writeParams } from "@/lib/urlState";
import type {
  AnalysisMode,
  AnalysisSummary,
  AnalyzeRequestBody,
  Leaderboard,
  PromptResult,
  RegionReport,
  RunCost,
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
  cost: RunCost | null;
}

type View = "run" | "usage" | "settings";
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "run", label: "Analysis" },
  { value: "usage", label: "Usage & costs" },
  { value: "settings", label: "Settings" },
];

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
  cost: null,
};

export function ChatGptTab() {
  const [state, setState] = useState<RunState>(initialState);
  const [serpLocation, setSerpLocation] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const [view, setView] = useState<View>(() => (VIEWS.some((v) => v.value === readParam("view")) ? (readParam("view") as View) : "run"));
  const { settings, save, reload } = useMentionsSettings();

  useEffect(() => {
    writeParams({ view: view === "run" ? null : view });
  }, [view]);

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
      void reload();
      return;
    }

    setState((s) => ({ ...s, running: false }));
    void reload();

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
          case "cost":
            return { ...s, cost: event.cost };
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
  }, [reload]);

  const summary = state.summary;
  const cost = state.cost;
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
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          ChatGPT Mentions
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Enter a question your customers might ask ChatGPT and the locations you care about. We generate realistic
          variations for each location, run them all through the ChatGPT API, and rank which businesses it recommends
          most - or how often your own brand makes the list.
        </p>
        </div>
        <div className="self-start">
          <Segmented value={view} options={VIEWS} onChange={setView} ariaLabel="ChatGPT Mentions view" />
        </div>
      </header>

      {view === "usage" ? <UsageView settings={settings} onOpenSettings={() => setView("settings")} /> : null}
      {view === "settings" ? <SettingsView settings={settings} save={save} /> : null}

      <div className={view === "run" ? "flex flex-col gap-6" : "hidden"}>
      <AnalyzeForm running={state.running} onSubmit={handleSubmit} onStop={handleStop} settings={settings} onOpenSettings={() => setView("settings")} />

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

      {cost && (state.running || summary || cost.final) ? (
        <div
          className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: cost.budgetHit ? "var(--status-critical)" : "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-secondary)" }}
          aria-live="polite"
        >
          <span>
            {cost.final ? "Run cost" : "Cost so far"}{" "}
            <span className="text-lg font-semibold tabular" style={{ color: "var(--text-primary)" }}>
              {cost.mock ? "$0.00" : fmtUsd(cost.actualUsd)}
            </span>
          </span>
          <span className="text-xs">
            {cost.mock
              ? `simulated run - with a real key about ${fmtUsd(cost.estimateUsd)}`
              : `estimated ${fmtUsd(cost.estimateUsd)} · ${cost.calls} calls · ${cost.inputTokens.toLocaleString("en-US")} input / ${cost.outputTokens.toLocaleString("en-US")} output tokens`}{" "}
            · {modelLabel(cost.model)}
          </span>
          {!cost.mock ? (
            <span className="text-xs">
              {cost.keyLabel}: {fmtUsd(cost.spentTodayUsd)} of {fmtUsd(cost.limitUsd)} today
            </span>
          ) : null}
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
    </div>
  );
}
