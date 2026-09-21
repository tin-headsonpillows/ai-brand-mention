"use client";

import { useCallback, useRef, useState } from "react";
import { AnalyzeForm } from "@/components/AnalyzeForm";
import { ProgressBar } from "@/components/ProgressBar";
import { StatTile } from "@/components/StatTile";
import { MentionRateChart, type MentionRateRow } from "@/components/MentionRateChart";
import { ResponseExplorer } from "@/components/ResponseExplorer";
import type { AnalysisSummary, AnalyzeRequestBody, PromptResult, StreamEvent } from "@/lib/types";
import { splitList } from "@/lib/mentions";

interface RunState {
  running: boolean;
  statusMessage: string | null;
  total: number;
  completed: number;
  results: PromptResult[];
  summary: AnalysisSummary | null;
  error: string | null;
  brand: string;
  competitors: string[];
}

const initialState: RunState = {
  running: false,
  statusMessage: null,
  total: 0,
  completed: 0,
  results: [],
  summary: null,
  error: null,
  brand: "",
  competitors: [],
};

export default function Home() {
  const [state, setState] = useState<RunState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSubmit = useCallback(async (body: AnalyzeRequestBody) => {
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...initialState,
      running: true,
      statusMessage: "Starting...",
      brand: body.brand,
      competitors: splitList(body.competitors),
    });

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
            return { ...s, summary: event.summary, statusMessage: "Done." };
          case "error":
            return { ...s, error: event.message };
          default:
            return s;
        }
      });
    }
  }, []);

  const mentionRows: MentionRateRow[] = state.summary
    ? [
        {
          name: state.summary.brand,
          mentionRate: state.summary.brandMentionRate,
          mentionCount: state.summary.brandMentionCount,
          totalOccurrences: state.summary.brandTotalOccurrences,
          isBrand: true,
        },
        ...state.summary.competitors.map((c) => ({
          name: c.name,
          mentionRate: c.mentionRate,
          mentionCount: c.mentionCount,
          totalOccurrences: c.totalOccurrences,
          isBrand: false,
        })),
      ]
    : [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          AI Brand Mention Tracker
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Enter a prompt your customers might ask ChatGPT. We&apos;ll generate similar prompts, run them all through
          the ChatGPT API, and measure how often your brand actually gets recommended.
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

      {state.summary ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile
              label="Brand mention rate"
              value={`${Math.round(state.summary.brandMentionRate * 100)}%`}
              sublabel={`${state.summary.brandMentionCount} of ${state.summary.completed} prompts`}
            />
            <StatTile label="Prompts run" value={String(state.summary.totalPrompts)} sublabel={state.summary.model} />
            <StatTile label="Total mentions" value={String(state.summary.brandTotalOccurrences)} sublabel="across all responses" />
            <StatTile
              label="Failed calls"
              value={String(state.summary.failed)}
              sublabel={state.summary.mock ? "mock mode" : "API errors"}
            />
          </div>

          {mentionRows.length > 1 ? (
            <MentionRateChart rows={mentionRows} completed={state.summary.completed} />
          ) : null}
        </>
      ) : null}

      {state.results.length > 0 ? (
        <ResponseExplorer results={state.results} brand={state.brand} competitors={state.competitors} />
      ) : null}
    </div>
  );
}
