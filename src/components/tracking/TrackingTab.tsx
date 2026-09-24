"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StatTile } from "@/components/StatTile";
import { SerpResultsViewer } from "./SerpResultsViewer";
import { VisibilityChart } from "./VisibilityChart";
import { computeVisibilityTrend, latestSnapshot } from "@/lib/tracking/aggregate";
import type { KeywordHistory, SerpUsage, TrackingConfig } from "@/lib/tracking/types";

const inputStyle: React.CSSProperties = {
  background: "var(--page-plane)",
  color: "var(--text-primary)",
  borderColor: "var(--border-hairline)",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

export function TrackingTab() {
  const [config, setConfig] = useState<TrackingConfig | null>(null);
  const [histories, setHistories] = useState<KeywordHistory[]>([]);
  const [usage, setUsage] = useState<SerpUsage | null>(null);
  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [configRes, historyRes, usageRes] = await Promise.all([
        fetch("/api/tracking/config"),
        fetch("/api/tracking/history"),
        fetch("/api/tracking/usage"),
      ]);
      const configData = (await configRes.json()) as TrackingConfig;
      const historyData = (await historyRes.json()) as { histories: KeywordHistory[] };
      const usageData = (await usageRes.json()) as SerpUsage;
      setConfig(configData);
      setHistories(historyData.histories);
      setUsage(usageData);
      setSelectedKeywordId((prev) => prev ?? configData.keywords[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracking data");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      try {
        const [configRes, historyRes, usageRes] = await Promise.all([
          fetch("/api/tracking/config"),
          fetch("/api/tracking/history"),
          fetch("/api/tracking/usage"),
        ]);
        const configData = (await configRes.json()) as TrackingConfig;
        const historyData = (await historyRes.json()) as { histories: KeywordHistory[] };
        const usageData = (await usageRes.json()) as SerpUsage;
        if (cancelled) return;
        setConfig(configData);
        setHistories(historyData.histories);
        setUsage(usageData);
        setSelectedKeywordId((prev) => prev ?? configData.keywords[0]?.id ?? null);
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
    try {
      const res = await fetch("/api/tracking/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`Failed to save (status ${res.status})`);
      const saved = (await res.json()) as TrackingConfig;
      setConfig(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  }, []);

  const runNow = useCallback(async () => {
    setRunning(true);
    setStatusMessage("Running tracking now...");
    setError(null);
    try {
      const res = await fetch("/api/tracking/run", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Run failed (status ${res.status})`);
      }
      const result = (await res.json()) as { totalSearchesUsed: number; mock: boolean; keywordResults: Array<{ error?: string }> };
      const failed = result.keywordResults.filter((r) => r.error).length;
      setStatusMessage(
        `Done${result.mock ? " (mock mode)" : ""}. ${result.totalSearchesUsed} SerpApi searches used${
          failed > 0 ? `, ${failed} keyword(s) failed` : ""
        }.`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
      setStatusMessage(null);
    } finally {
      setRunning(false);
    }
  }, [loadAll]);

  const addKeyword = useCallback(() => {
    if (!config || !newKeyword.trim()) return;
    const keyword = { id: crypto.randomUUID(), keyword: newKeyword.trim(), active: true, createdAt: new Date().toISOString() };
    saveConfig({ ...config, keywords: [...config.keywords, keyword] });
    setNewKeyword("");
  }, [config, newKeyword, saveConfig]);

  const removeKeyword = useCallback(
    (id: string) => {
      if (!config) return;
      saveConfig({ ...config, keywords: config.keywords.filter((k) => k.id !== id) });
    },
    [config, saveConfig]
  );

  const toggleKeyword = useCallback(
    (id: string) => {
      if (!config) return;
      saveConfig({
        ...config,
        keywords: config.keywords.map((k) => (k.id === id ? { ...k, active: !k.active } : k)),
      });
    },
    [config, saveConfig]
  );

  const trendPoints = useMemo(() => computeVisibilityTrend(histories), [histories]);

  const todaySummary = useMemo(() => {
    const active = config?.keywords.filter((k) => k.active) ?? [];
    if (active.length === 0) return null;
    let organic = 0;
    let aiOverview = 0;
    let aiMode = 0;
    let withData = 0;
    for (const kw of active) {
      const history = histories.find((h) => h.keywordId === kw.id);
      const latest = history ? latestSnapshot(history) : null;
      if (!latest) continue;
      withData++;
      if (latest.brandHit.organic.matched) organic++;
      if (latest.brandHit.aiOverview.matched) aiOverview++;
      if (latest.brandHit.aiMode.matched) aiMode++;
    }
    if (withData === 0) return null;
    return {
      organicPct: Math.round((organic / withData) * 100),
      aiOverviewPct: Math.round((aiOverview / withData) * 100),
      aiModePct: Math.round((aiMode / withData) * 100),
      withData,
      total: active.length,
    };
  }, [config, histories]);

  const selectedHistory = histories.find((h) => h.keywordId === selectedKeywordId) ?? null;
  const selectedSnapshot = selectedHistory ? latestSnapshot(selectedHistory) : null;
  const selectedKeyword = config?.keywords.find((k) => k.id === selectedKeywordId);

  if (!config) {
    return <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading tracking data...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Google Search Tracking
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Track your keywords daily across Google Search, AI Overviews, and AI Mode, and see how often your brand
          shows up.
        </p>
      </header>

      {error ? (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}
        >
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatTile
          label="SerpApi searches left"
          value={usage?.planSearchesLeft != null ? String(usage.planSearchesLeft) : "-"}
          sublabel={usage?.mock ? "mock data" : usage?.planId ?? undefined}
        />
        <StatTile
          label="Used this month"
          value={usage?.thisMonthUsage != null ? String(usage.thisMonthUsage) : "-"}
          sublabel={usage?.searchesPerMonth != null ? `of ${usage.searchesPerMonth}/mo` : undefined}
        />
        <StatTile
          label="Today's visibility"
          value={todaySummary ? `${todaySummary.organicPct}%` : "-"}
          sublabel="organic results"
        />
        <StatTile
          label="Keywords tracked"
          value={String(config.keywords.filter((k) => k.active).length)}
          sublabel={`${config.keywords.length} total`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Tracking settings">
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Language
              <select
                value={config.settings.language}
                onChange={(e) => saveConfig({ ...config, settings: { ...config.settings, language: e.target.value } })}
                className="rounded border px-2 py-1.5 text-sm"
                style={inputStyle}
              >
                {["en", "es", "fr", "de", "pt", "vi", "ja", "ko", "zh-cn"].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Country
              <select
                value={config.settings.country}
                onChange={(e) => saveConfig({ ...config, settings: { ...config.settings, country: e.target.value } })}
                className="rounded border px-2 py-1.5 text-sm"
                style={inputStyle}
              >
                {["us", "uk", "vn", "au", "ca", "de", "fr", "jp", "in"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Device
              <select
                value={config.settings.device}
                onChange={(e) =>
                  saveConfig({
                    ...config,
                    settings: { ...config.settings, device: e.target.value as TrackingConfig["settings"]["device"] },
                  })
                }
                className="rounded border px-2 py-1.5 text-sm"
                style={inputStyle}
              >
                <option value="mobile">mobile</option>
                <option value="desktop">desktop</option>
                <option value="tablet">tablet</option>
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--gridline)" }}>
            <div className="flex flex-col">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {config.keywords.length} keyword(s) tracked - runs once daily automatically
              </span>
              {statusMessage ? (
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {statusMessage}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={runNow}
              disabled={running}
              className="rounded px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--series-1)" }}
            >
              {running ? "Running..." : "Run now"}
            </button>
          </div>
        </Card>

        <Card title="Your brand">
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            Brand name
            <input
              value={config.brand.name}
              onChange={(e) => setConfig({ ...config, brand: { ...config.brand, name: e.target.value } })}
              onBlur={() => saveConfig(config)}
              placeholder="e.g. Furama Resort"
              className="rounded border px-2 py-1.5 text-sm"
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            Aliases (comma-separated)
            <input
              value={config.brand.aliases.join(", ")}
              onChange={(e) =>
                setConfig({
                  ...config,
                  brand: { ...config.brand, aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) },
                })
              }
              onBlur={() => saveConfig(config)}
              placeholder="Furama Danang"
              className="rounded border px-2 py-1.5 text-sm"
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            Website (root domain)
            <input
              value={config.brand.website}
              onChange={(e) => setConfig({ ...config, brand: { ...config.brand, website: e.target.value } })}
              onBlur={() => saveConfig(config)}
              placeholder="furamavietnam.com"
              className="rounded border px-2 py-1.5 text-sm"
              style={inputStyle}
            />
          </label>
        </Card>
      </div>

      <Card title="Tracked keywords">
        <div className="flex gap-2">
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder="e.g. best hotel for family in Da Nang"
            className="flex-1 rounded border px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={addKeyword}
            className="rounded border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
          >
            Add
          </button>
        </div>
        {config.keywords.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No keywords yet - add one above.
          </p>
        ) : (
          <ul className="flex flex-col divide-y" style={{ borderColor: "var(--gridline)" }}>
            {config.keywords.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <label className="flex flex-1 items-center gap-2">
                  <input type="checkbox" checked={k.active} onChange={() => toggleKeyword(k.id)} />
                  <button
                    type="button"
                    onClick={() => setSelectedKeywordId(k.id)}
                    className="truncate text-left"
                    style={{
                      color: k.id === selectedKeywordId ? "var(--series-1)" : "var(--text-primary)",
                      fontWeight: k.id === selectedKeywordId ? 600 : 400,
                    }}
                  >
                    {k.keyword}
                  </button>
                </label>
                <button
                  type="button"
                  onClick={() => removeKeyword(k.id)}
                  className="text-xs"
                  style={{ color: "var(--status-critical)" }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <VisibilityChart points={trendPoints} />

      {selectedKeyword ? (
        <SerpResultsViewer keyword={selectedKeyword.keyword} snapshot={selectedSnapshot} brand={config.brand} />
      ) : null}
    </div>
  );
}
