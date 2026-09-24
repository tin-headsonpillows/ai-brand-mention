"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SURFACE_LABEL,
  buildSubjects,
  collectDates,
  computeDomainRows,
  computeSubjectSeries,
  computeSurfaceSplit,
  createHitLookup,
  filterByRange,
  summarizeSeries,
  type AiSurface,
  type SurfaceFilter,
} from "@/lib/tracking/analytics";
import type { KeywordHistory, SerpUsage, TrackingConfig } from "@/lib/tracking/types";
import { Favicon } from "./Favicon";
import { MentionsView } from "./MentionsView";
import { OverviewView } from "./OverviewView";
import { RankTrackerView } from "./RankTrackerView";
import { ResponsesView } from "./ResponsesView";
import { SettingsView } from "./SettingsView";
import { EmptyState, IconCalendar, IconLayers, SelectControl } from "./ui";

type View = "overview" | "rank" | "mentions" | "responses" | "settings";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "rank", label: "Rank tracker" },
  { id: "mentions", label: "Mentions & Citations" },
  { id: "responses", label: "AI responses" },
  { id: "settings", label: "Settings" },
];

type Range = "7" | "30" | "90" | "all";

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const SURFACE_OPTIONS: Array<{ value: SurfaceFilter; label: string }> = [
  { value: "all", label: "All surfaces" },
  { value: "organic", label: SURFACE_LABEL.organic },
  { value: "aiOverview", label: SURFACE_LABEL.aiOverview },
  { value: "aiMode", label: SURFACE_LABEL.aiMode },
];

async function fetchAll() {
  const [configRes, historyRes, usageRes] = await Promise.all([
    fetch("/api/tracking/config"),
    fetch("/api/tracking/history"),
    fetch("/api/tracking/usage"),
  ]);
  const config = (await configRes.json()) as TrackingConfig;
  const { histories } = (await historyRes.json()) as { histories: KeywordHistory[] };
  const usage = usageRes.ok ? ((await usageRes.json()) as SerpUsage) : null;
  return { config, histories, usage };
}

export function TrackingTab() {
  const [config, setConfig] = useState<TrackingConfig | null>(null);
  const [histories, setHistories] = useState<KeywordHistory[]>([]);
  const [usage, setUsage] = useState<SerpUsage | null>(null);
  const [view, setView] = useState<View>("overview");
  const [range, setRange] = useState<Range>("30");
  const [surface, setSurface] = useState<SurfaceFilter>("all");
  const [compare, setCompare] = useState(true);
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      try {
        const data = await fetchAll();
        if (cancelled) return;
        setConfig(data.config);
        setHistories(data.histories);
        setUsage(data.usage);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load tracking data");
      }
    }
    initialLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveConfig = useCallback(async (next: TrackingConfig) => {
    setError(null);
    setConfig(next);
    try {
      const res = await fetch("/api/tracking/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`Failed to save settings (status ${res.status})`);
      const saved = (await res.json()) as TrackingConfig;
      setConfig(saved);
      setHistories((prev) =>
        saved.keywords.map((k) => prev.find((h) => h.keywordId === k.id) ?? { keywordId: k.id, keyword: k.keyword, days: [] })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  }, []);

  const runNow = useCallback(async () => {
    setRunning(true);
    setStatusMessage("Running tracking for every active keyword…");
    setError(null);
    try {
      const res = await fetch("/api/tracking/run", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        totalSearchesUsed?: number;
        mock?: boolean;
        keywordResults?: Array<{ error?: string }>;
      };
      if (!res.ok) throw new Error(body.error || `Run failed (status ${res.status})`);
      const failed = body.keywordResults?.filter((r) => r.error).length ?? 0;
      setStatusMessage(
        `Done${body.mock ? " (mock data)" : ""} · ${body.totalSearchesUsed ?? 0} SerpApi searches used${failed > 0 ? ` · ${failed} keyword(s) failed` : ""}`
      );
      const data = await fetchAll();
      setConfig(data.config);
      setHistories(data.histories);
      setUsage(data.usage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
      setStatusMessage(null);
    } finally {
      setRunning(false);
    }
  }, []);

  const subjects = useMemo(
    () => (config ? buildSubjects(config.brand, config.competitors) : []),
    [config]
  );
  const hits = useMemo(() => createHitLookup(subjects), [subjects]);
  const ranged = useMemo(() => filterByRange(histories, range === "all" ? null : Number(range)), [histories, range]);
  const { dates, series } = useMemo(() => computeSubjectSeries(ranged, subjects, hits, surface), [ranged, subjects, hits, surface]);
  const summaries = useMemo(() => summarizeSeries(series), [series]);
  const surfaceSplit = useMemo(() => (surface === "all" && subjects.length > 0 ? computeSurfaceSplit(ranged, hits) : null), [surface, ranged, hits, subjects]);
  const domains = useMemo(
    () => (config ? computeDomainRows(ranged, subjects, config.excludedDomains, surface) : { rows: [], hiddenCount: 0 }),
    [ranged, subjects, config, surface]
  );
  const aiSurfaces: AiSurface[] = surface === "all" ? ["aiOverview", "aiMode"] : surface === "organic" ? [] : [surface];

  if (!config) {
    return error ? (
      <EmptyState title="Couldn't load tracking data" body={error} />
    ) : (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading tracking data…
      </p>
    );
  }

  const localeLabel = `${config.settings.language} · ${config.settings.country} · ${config.settings.device}`;
  const periodLabel = `Showing ${dates.length} tracked day${dates.length === 1 ? "" : "s"}`;
  const allDates = collectDates(histories);
  const hasData = allDates.length > 0;
  const needsSetup = config.keywords.length === 0 || !config.brand.name.trim();
  const searchesLeft = usage?.totalSearchesLeft ?? usage?.planSearchesLeft ?? null;

  const excludeDomain = (domain: string) => {
    if (config.excludedDomains.includes(domain)) return;
    saveConfig({ ...config, excludedDomains: [...config.excludedDomains, domain] });
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Google Search Tracking
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Daily rankings, AI Overview and AI Mode visibility for your keywords
            {allDates.length > 0 ? ` · last run ${allDates[allDates.length - 1]}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-lg border px-2.5 py-1.5 text-xs"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", background: "var(--surface-1)" }}
            title={
              usage && !usage.mock
                ? `${usage.thisMonthUsage ?? "?"} used of ${usage.searchesPerMonth ?? "?"} this month${usage.keyPoolSize > 1 ? ` · key ${(usage.activeKeyIndex ?? 0) + 1} of ${usage.keyPoolSize}` : ""}`
                : "Mock data - no SerpApi key configured"
            }
          >
            SerpApi{" "}
            <strong className="tabular" style={{ color: "var(--text-primary)" }}>
              {searchesLeft != null ? searchesLeft.toLocaleString("en-US") : "–"}
            </strong>{" "}
            searches left
            {usage && usage.keyPoolSize > 1 ? ` · key ${(usage.activeKeyIndex ?? 0) + 1}/${usage.keyPoolSize}` : ""}
            {usage?.mock ? " · mock" : ""}
          </span>
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {running ? "Running…" : "Run now"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }} role="alert">
          {error}
        </div>
      ) : null}
      {statusMessage ? (
        <div className="rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }} role="status">
          {statusMessage}
        </div>
      ) : null}

      <nav className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--gridline)" }} aria-label="Tracking views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            aria-current={view === v.id ? "page" : undefined}
            className="-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium"
            style={{
              borderColor: view === v.id ? "var(--text-primary)" : "transparent",
              color: view === v.id ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {view !== "settings" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setView("settings")}
            className="flex items-center gap-2 rounded-lg border py-1.5 pl-2 pr-3 text-xs font-semibold"
            style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            title="Edit brand in Settings"
          >
            <Favicon domain={config.brand.website} label={config.brand.name} size={16} />
            {config.brand.name || "Set your brand"}
          </button>
          <SelectControl ariaLabel="Date range" icon={<IconCalendar />} value={range} onChange={setRange} options={RANGE_OPTIONS} />
          {view !== "rank" ? (
            <SelectControl ariaLabel="Search surface" icon={<IconLayers />} value={surface} onChange={setSurface} options={SURFACE_OPTIONS} />
          ) : null}
          <button
            type="button"
            onClick={() => setView("settings")}
            className="rounded-lg border px-2.5 py-1.5 text-xs uppercase"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", background: "var(--surface-1)" }}
            title="Search settings"
          >
            {localeLabel}
          </button>
          <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
            {subjects.length - 1} competitor{subjects.length - 1 === 1 ? "" : "s"} · {config.keywords.filter((k) => k.active).length} keywords
          </span>
        </div>
      ) : null}

      {view === "settings" ? (
        <SettingsView config={config} onDraftChange={setConfig} onSave={saveConfig} />
      ) : needsSetup && !hasData ? (
        <EmptyState
          title="Set up tracking"
          body="Add your brand, the competitors you want to compare against, and the keywords to track. Then run tracking once to start building history."
          action={
            <button
              type="button"
              onClick={() => setView("settings")}
              className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: "var(--series-1)" }}
            >
              Open settings
            </button>
          }
        />
      ) : !hasData ? (
        <EmptyState
          title="No tracking data yet"
          body="Tracking runs automatically every day. Run it now to capture today's results."
          action={
            <button
              type="button"
              onClick={runNow}
              disabled={running}
              className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--series-1)" }}
            >
              {running ? "Running…" : "Run now"}
            </button>
          }
        />
      ) : view === "overview" ? (
        <OverviewView
          dates={dates}
          series={series}
          summaries={summaries}
          surfaceSplit={surfaceSplit}
          compare={compare}
          onCompareChange={setCompare}
          periodLabel={periodLabel}
        />
      ) : view === "rank" ? (
        <RankTrackerView histories={ranged} subjects={subjects} hits={hits} localeLabel={localeLabel} />
      ) : view === "mentions" ? (
        <MentionsView
          dates={dates}
          series={series}
          domainRows={domains.rows}
          hiddenCount={domains.hiddenCount}
          compare={compare}
          onCompareChange={setCompare}
          onExclude={excludeDomain}
          periodLabel={periodLabel}
          surfaceLabel={SURFACE_OPTIONS.find((o) => o.value === surface)?.label ?? "All surfaces"}
        />
      ) : (
        <ResponsesView histories={ranged} dates={dates} subjects={subjects} hits={hits} surfaces={aiSurfaces} localeLabel={localeLabel} />
      )}
    </div>
  );
}
