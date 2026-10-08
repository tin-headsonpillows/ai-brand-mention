"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CostReport } from "@/lib/brand/costs";
import type { Dashboard } from "@/lib/brand/dashboard";
import { PLATFORMS, PLATFORM_LABEL, type BrandPrompt, type BrandSettings, type Cycle, type CycleSummary, type FactVerdict, type Platform } from "@/lib/brand/types";
import type { TrackedBrand } from "@/lib/tracking/types";
import { readParam, writeParams } from "@/lib/urlState";
import { EmptyState, IconCalendar, IconLayers, SelectControl } from "@/components/tracking/ui";
import { AttributesGrid, BrandFacts, HeadToHead, PerceptionCard, SentimentTrend, SourceSentiment } from "./BrandCards";
import { CostsPanel } from "./CostsPanel";
import { PromptsPanel } from "./PromptsPanel";
import { ResponsesPanel } from "./ResponsesPanel";

type Section = "dashboard" | "prompts" | "responses" | "costs";
type Range = "30" | "90" | "180" | "365" | "all";

interface Payload {
  dashboard: Dashboard;
  settings: BrandSettings;
  costs: CostReport;
  brand: TrackedBrand;
  competitors: Array<{ name: string; website: string }>;
  allCycles: CycleSummary[];
}

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "prompts", label: "Prompts" },
  { id: "responses", label: "AI answers" },
  { id: "costs", label: "Costs & limits" },
];

/**
 * Brand Mentions: what Google AI Mode, AI Overview, ChatGPT and Claude say about the project's brand for a set of
 * prompts - perception, sentiment over time, head-to-head with competitors, attributes, facts and sources.
 */
export function BrandMentionsView({ projectId, onOpenSettings }: { projectId: string; onOpenSettings: () => void }) {
  const [section, setSection] = useState<Section>(() => (SECTIONS.some((s) => s.id === readParam("bm")) ? (readParam("bm") as Section) : "dashboard"));
  const [range, setRange] = useState<Range>("90");
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [promptType, setPromptType] = useState<"all" | "branded" | "unbranded">("all");
  const [topic, setTopic] = useState("all");
  const [data, setData] = useState<Payload | null>(null);
  const [prompts, setPrompts] = useState<BrandPrompt[] | null>(null);
  const [maxPrompts, setMaxPrompts] = useState(200);
  const [latestCycle, setLatestCycle] = useState<Cycle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    writeParams({ bm: section === "dashboard" ? null : section });
  }, [section]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ project: projectId, range, platform, type: promptType, topic });
    const res = await fetch(`/api/brand/dashboard?${params}`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Payload & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Couldn't load brand mentions");
      return;
    }
    setError(null);
    setData(body);
  }, [projectId, range, platform, promptType, topic]);

  const loadPrompts = useCallback(async () => {
    const res = await fetch(`/api/brand/prompts?project=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { prompts?: BrandPrompt[]; max?: number };
    setPrompts(body.prompts ?? []);
    if (body.max) setMaxPrompts(body.max);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) await load();
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) await loadPrompts();
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadPrompts]);

  // Latest run's answers, for the per-prompt "mentioned" column.
  const latestId = data?.allCycles.at(-1)?.id;
  const latestDone = data?.allCycles.at(-1)?.done;
  useEffect(() => {
    if (!latestId) return;
    let cancelled = false;
    async function run(id: string) {
      const res = await fetch(`/api/brand/cycle?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { cycle?: Cycle };
      if (!cancelled) setLatestCycle(body.cycle ?? null);
    }
    void run(latestId);
    return () => {
      cancelled = true;
    };
  }, [projectId, latestId, latestDone]);

  const mentionRate = useMemo(() => {
    const out: Record<string, { mentioned: number; answered: number }> = {};
    for (const r of latestCycle?.responses ?? []) {
      const e = (out[r.promptId] ??= { mentioned: 0, answered: 0 });
      if (r.present) e.answered++;
      if (r.analysis?.brandMentioned) e.mentioned++;
    }
    return out;
  }, [latestCycle]);

  /** Runs in chunks (each call stops before the server time limit) until the run is finished, paused by budget, or stopped. */
  async function runNow() {
    setRunning(true);
    setRunMessage("Starting...");
    stopRef.current = false;
    try {
      for (let i = 0; i < 30 && !stopRef.current; i++) {
        const res = await fetch(`/api/brand/run?project=${encodeURIComponent(projectId)}`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as { cycle?: CycleSummary | null; ran?: number; stoppedBy?: string; message?: string; error?: string };
        if (!res.ok) throw new Error(body.error ?? `Run failed (${res.status})`);
        await load();
        const c = body.cycle;
        if (body.stoppedBy === "no-prompts") {
          setRunMessage(body.message ?? "Add prompts first.");
          setSection("prompts");
          break;
        }
        if (body.stoppedBy === "budget") {
          setRunMessage(body.message ?? "Daily spending limit reached; the run continues tomorrow.");
          break;
        }
        if (body.stoppedBy === "locked") {
          setRunMessage("A run is already in progress (started elsewhere). Refresh in a few minutes.");
          break;
        }
        if (c?.status === "done") {
          setRunMessage(`Run finished: ${c.done} answers · $${c.costUsd.toFixed(2)} · ${c.serpCredits} SerpApi credits.`);
          break;
        }
        setRunMessage(`Collecting answers... ${c?.done ?? 0} of ${c?.total ?? "?"}`);
      }
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function setVerdict(key: string, verdict: FactVerdict | null) {
    setData((d) => (d ? { ...d, dashboard: { ...d.dashboard, facts: d.dashboard.facts.map((f) => (f.key === key ? { ...f, verdict } : f)) } } : d));
    await fetch("/api/brand/facts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId, key, verdict }) });
  }

  async function saveSettings(patch: Partial<BrandSettings> & { dailyLimitUsd?: number }) {
    await fetch("/api/brand/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId, ...patch }) });
    await load();
  }

  if (error) {
    return (
      <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
        {error}
      </p>
    );
  }
  if (!data || prompts === null) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading brand mentions...
      </p>
    );
  }

  const d = data.dashboard;
  const current = data.allCycles.at(-1);
  const unfinished = current && current.status !== "done" ? current : null;
  const brandName = data.brand.name;
  const brandTerms = [data.brand.name, ...data.brand.aliases].filter(Boolean);
  const otherBrands = [...new Set([...data.competitors.map((c) => c.name), ...d.brands.filter((b) => !b.isTarget).map((b) => b.name)])];
  const activePrompts = prompts.filter((p) => p.active).length;
  const mockPlatforms = PLATFORMS.filter((p) => data.settings.platforms[p] && data.costs.mock[p]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg p-0.5" style={{ background: "var(--page-plane)", border: "1px solid var(--border-hairline)" }} role="tablist" aria-label="Brand mentions sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              onClick={() => setSection(s.id)}
              className="rounded-md px-3 py-1 text-xs font-medium"
              style={{ background: section === s.id ? "var(--surface-1)" : "transparent", color: section === s.id ? "var(--text-primary)" : "var(--text-muted)", boxShadow: section === s.id ? "0 1px 2px rgba(0,0,0,0.08)" : undefined }}
            >
              {s.label}
              {s.id === "prompts" ? ` (${activePrompts})` : ""}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Today {`$${data.costs.today.totalUsd.toFixed(2)}`} of ${data.costs.limit.toFixed(2)} · ≈${data.costs.perRun.total.toFixed(2)}/run
          </span>
          {running ? (
            <button type="button" onClick={() => (stopRef.current = true)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
              Stop after this batch
            </button>
          ) : null}
          <button type="button" onClick={() => void runNow()} disabled={running} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" style={{ background: "var(--series-1)" }}>
            {running ? "Running..." : unfinished ? `Continue run (${unfinished.done}/${unfinished.total})` : "Run brand check now"}
          </button>
        </div>
      </div>

      {runMessage || unfinished?.note ? (
        <div className="rounded-lg border px-4 py-2.5 text-sm" role="status" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
          {runMessage ?? unfinished?.note}
        </div>
      ) : null}
      {mockPlatforms.length ? (
        <p className="text-xs" style={{ color: "var(--status-serious)" }}>
          Placeholder answers for {mockPlatforms.map((p) => PLATFORM_LABEL[p]).join(", ")} - the API key isn&apos;t configured on the server.
        </p>
      ) : null}

      {!brandName ? (
        <EmptyState
          title="Set your brand first"
          body="Brand Mentions needs the brand name (and aliases) from this project's settings."
          action={
            <button type="button" onClick={onOpenSettings} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--series-1)" }}>
              Open settings
            </button>
          }
        />
      ) : section === "prompts" ? (
        <PromptsPanel projectId={projectId} prompts={prompts} max={maxPrompts} brandName={brandName} onChange={setPrompts} mentionRate={mentionRate} />
      ) : section === "responses" ? (
        <ResponsesPanel key={data.allCycles.length} projectId={projectId} cycles={data.allCycles} brandTerms={brandTerms} otherBrands={otherBrands} />
      ) : section === "costs" ? (
        <CostsPanel costs={data.costs} settings={data.settings} onSave={saveSettings} />
      ) : data.allCycles.length === 0 ? (
        <EmptyState
          title={prompts.length ? "No brand check yet" : "Add the prompts to track"}
          body={
            prompts.length
              ? `Run a brand check to ask ${activePrompts} prompts on Google AI Mode, AI Overview, ChatGPT and Claude (about $${data.costs.perRun.total.toFixed(2)} and ${data.costs.perRun.serpCredits} SerpApi credits). After that it runs weekly.`
              : "Add questions people ask AI about your brand, products and category - type them, upload a CSV, or let ChatGPT suggest them."
          }
          action={
            <button
              type="button"
              onClick={() => (prompts.length ? void runNow() : setSection("prompts"))}
              disabled={running}
              className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--series-1)" }}
            >
              {prompts.length ? "Run brand check now" : "Add prompts"}
            </button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SelectControl
              ariaLabel="Date range"
              icon={<IconCalendar />}
              value={range}
              onChange={setRange}
              options={[
                { value: "30", label: "Last 30 days" },
                { value: "90", label: "Last 90 days" },
                { value: "180", label: "Last 6 months" },
                { value: "365", label: "Last 12 months" },
                { value: "all", label: "All time" },
              ]}
            />
            <SelectControl
              ariaLabel="Platform"
              icon={<IconLayers />}
              value={platform}
              onChange={setPlatform}
              options={[{ value: "all" as const, label: "All platforms" }, ...PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))]}
            />
            <SelectControl
              ariaLabel="Prompt type"
              value={promptType}
              onChange={setPromptType}
              options={[
                { value: "all", label: "Branded & Unbranded" },
                { value: "branded", label: "Branded" },
                { value: "unbranded", label: "Unbranded" },
              ]}
            />
            <SelectControl ariaLabel="Topic" value={topic} onChange={setTopic} options={[{ value: "all", label: "All topics" }, ...d.topics.map((t) => ({ value: t, label: t }))]} />
            <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
              Latest run: {d.answers.mentioned} of {d.answers.present} answers mention {brandName}
            </span>
          </div>
          <PerceptionCard data={d} brandName={brandName} platform={platform} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <SentimentTrend trend={d.trend} />
            <HeadToHead brands={d.brands} websites={Object.fromEntries([[brandName, data.brand.website], ...data.competitors.map((c) => [c.name, c.website])])} />
            <AttributesGrid attributes={d.attributes} />
            <BrandFacts facts={d.facts} onVerdict={(k, v) => void setVerdict(k, v)} />
          </div>
          <SourceSentiment sources={d.sources} brandName={brandName} />
        </>
      )}
    </div>
  );
}
