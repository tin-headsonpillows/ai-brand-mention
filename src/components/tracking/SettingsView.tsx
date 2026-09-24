"use client";

import { useState } from "react";
import type { DomainRow } from "@/lib/tracking/analytics";
import { formatPosition } from "@/lib/tracking/format";
import type { TrackedCompetitor, TrackingConfig } from "@/lib/tracking/types";
import { Favicon } from "./Favicon";
import { Panel, TrackButton, inputStyle } from "./ui";

interface SettingsViewProps {
  config: TrackingConfig;
  onDraftChange: (next: TrackingConfig) => void;
  onSave: (next: TrackingConfig) => void;
  /** Domains seen in your SERPs that aren't your site or an already-tracked competitor. */
  suggestions: DomainRow[];
  onTrack: (domain: string) => void;
  onExclude: (domain: string) => void;
}

const LANGUAGES = [
  ["en", "English"],
  ["vi", "Vietnamese"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh-cn", "Chinese (Simplified)"],
  ["th", "Thai"],
] as const;

const COUNTRIES = [
  ["us", "United States"],
  ["uk", "United Kingdom"],
  ["vn", "Vietnam"],
  ["au", "Australia"],
  ["ca", "Canada"],
  ["de", "Germany"],
  ["fr", "France"],
  ["jp", "Japan"],
  ["kr", "South Korea"],
  ["sg", "Singapore"],
  ["th", "Thailand"],
  ["in", "India"],
] as const;

const fieldLabel = "flex flex-col gap-1 text-xs";

export function SettingsView({ config, onDraftChange, onSave, suggestions, onTrack, onExclude }: SettingsViewProps) {
  const [newKeywords, setNewKeywords] = useState("");
  const [filter, setFilter] = useState("");

  const addKeywords = () => {
    const existing = new Set(config.keywords.map((k) => k.keyword.toLowerCase()));
    const added = newKeywords
      .split("\n")
      .map((k) => k.trim())
      .filter((k) => k && !existing.has(k.toLowerCase()))
      .map((keyword) => ({ id: crypto.randomUUID(), keyword, active: true, createdAt: new Date().toISOString() }));
    if (added.length === 0) return;
    onSave({ ...config, keywords: [...config.keywords, ...added] });
    setNewKeywords("");
  };

  const query = filter.trim().toLowerCase();
  const visibleSuggestions = query
    ? suggestions.filter((r) => r.domain.includes(query) || r.siteName.toLowerCase().includes(query))
    : suggestions;

  const updateCompetitor = (id: string, patch: Partial<TrackedCompetitor>) =>
    onDraftChange({ ...config, competitors: config.competitors.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const splitAliases = (value: string) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Search settings" subtitle="Where and how Google is queried">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={fieldLabel} style={{ color: "var(--text-secondary)" }}>
            Language
            <select
              value={config.settings.language}
              onChange={(e) => onSave({ ...config, settings: { ...config.settings, language: e.target.value } })}
              className="rounded-lg border px-2.5 py-2 text-sm"
              style={inputStyle}
            >
              {LANGUAGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel} style={{ color: "var(--text-secondary)" }}>
            Country
            <select
              value={config.settings.country}
              onChange={(e) => onSave({ ...config, settings: { ...config.settings, country: e.target.value } })}
              className="rounded-lg border px-2.5 py-2 text-sm"
              style={inputStyle}
            >
              {COUNTRIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel} style={{ color: "var(--text-secondary)" }}>
            Device
            <select
              value={config.settings.device}
              onChange={(e) =>
                onSave({ ...config, settings: { ...config.settings, device: e.target.value as TrackingConfig["settings"]["device"] } })
              }
              className="rounded-lg border px-2.5 py-2 text-sm"
              style={inputStyle}
            >
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
              <option value="tablet">Tablet</option>
            </select>
          </label>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Tracking runs automatically every day at 03:00 UTC. Each keyword costs 2-3 SerpApi searches per run (organic
          results, AI Overview when Google shows one, and AI Mode).
        </p>
      </Panel>

      <Panel title="Your brand" subtitle="Matched by name, aliases and website">
        <div className="flex items-center gap-3">
          <Favicon domain={config.brand.website} label={config.brand.name} size={28} />
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={fieldLabel} style={{ color: "var(--text-secondary)" }}>
              Brand name
              <input
                value={config.brand.name}
                onChange={(e) => onDraftChange({ ...config, brand: { ...config.brand, name: e.target.value } })}
                onBlur={() => onSave(config)}
                placeholder="e.g. Bhaya Cruises"
                className="rounded-lg border px-2.5 py-2 text-sm"
                style={inputStyle}
              />
            </label>
            <label className={fieldLabel} style={{ color: "var(--text-secondary)" }}>
              Website
              <input
                value={config.brand.website}
                onChange={(e) => onDraftChange({ ...config, brand: { ...config.brand, website: e.target.value } })}
                onBlur={() => onSave(config)}
                placeholder="bhayacruises.com"
                className="rounded-lg border px-2.5 py-2 text-sm"
                style={inputStyle}
              />
            </label>
          </div>
        </div>
        <label className={fieldLabel} style={{ color: "var(--text-secondary)" }}>
          Aliases (comma-separated)
          <input
            value={config.brand.aliases.join(", ")}
            onChange={(e) => onDraftChange({ ...config, brand: { ...config.brand, aliases: splitAliases(e.target.value) } })}
            onBlur={() => onSave(config)}
            placeholder="Bhaya, Bhaya Halong Cruise"
            className="rounded-lg border px-2.5 py-2 text-sm"
            style={inputStyle}
          />
        </label>
      </Panel>

      <Panel
        title="Competitors"
        subtitle="Pick them from the sites that actually rank for your keywords"
        className="xl:col-span-2"
        bodyClassName="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      >
        <div className="flex flex-col gap-3 border-b p-4 lg:border-b-0 lg:border-r" style={{ borderColor: "var(--border-hairline)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            Tracking ({config.competitors.length})
          </span>
          {config.competitors.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              None yet. Click <strong>+ Track</strong> on a site from your SERPs - rankings, share of voice and the rank
              tracker then compare you against it, including on days already tracked.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {config.competitors.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 rounded-lg border p-2.5" style={{ borderColor: "var(--border-hairline)" }}>
                  <div className="flex items-center gap-2">
                    <Favicon domain={c.website} label={c.name} size={18} />
                    <input
                      value={c.name}
                      onChange={(e) => updateCompetitor(c.id, { name: e.target.value })}
                      onBlur={() => onSave(config)}
                      aria-label="Competitor name"
                      className="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm font-medium"
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => onSave({ ...config, competitors: config.competitors.filter((x) => x.id !== c.id) })}
                      className="shrink-0 text-xs"
                      style={{ color: "var(--status-critical)" }}
                    >
                      Stop tracking
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pl-[26px] text-xs" style={{ color: "var(--text-muted)" }}>
                    <span className="shrink-0">{c.website || "no website"}</span>
                    <input
                      value={c.aliases.join(", ")}
                      onChange={(e) => updateCompetitor(c.id, { aliases: splitAliases(e.target.value) })}
                      onBlur={() => onSave(config)}
                      placeholder="Other names it goes by (comma-separated)"
                      aria-label="Competitor aliases"
                      className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs"
                      style={inputStyle}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              Suggested from your SERPs ({suggestions.length})
            </span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter sites"
              aria-label="Filter suggested sites"
              className="w-40 rounded-md border px-2 py-1 text-xs"
              style={inputStyle}
            />
          </div>
          {suggestions.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Run tracking once and every site that ranks or gets cited for your keywords will show up here.
            </p>
          ) : (
            <ul className="flex max-h-[420px] flex-col overflow-y-auto">
              {visibleSuggestions.map((r) => {
                const aiCitations = r.aiOverviewCitations + r.aiModeCitations;
                return (
                  <li key={r.domain} className="flex items-center gap-2.5 border-b py-2 last:border-b-0" style={{ borderColor: "var(--gridline)" }}>
                    <Favicon domain={r.domain} label={r.siteName} size={20} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {r.siteName}
                      </span>
                      <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {r.domain} · {r.keywords} keyword{r.keywords === 1 ? "" : "s"}
                        {r.avgPosition != null ? ` · avg ${formatPosition(Math.round(r.avgPosition * 10) / 10)}` : ""}
                        {aiCitations > 0 ? ` · ${aiCitations} AI citation${aiCitations === 1 ? "" : "s"}` : ""}
                      </span>
                    </div>
                    <TrackButton onClick={() => onTrack(r.domain)} />
                    <button
                      type="button"
                      onClick={() => onExclude(r.domain)}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                      title="Not a competitor (blog, OTA, forum) - hide it"
                    >
                      Hide
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() =>
              onDraftChange({
                ...config,
                competitors: [...config.competitors, { id: crypto.randomUUID(), name: "", aliases: [], website: "" }],
              })
            }
            className="self-start text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Not in your SERPs yet? Add one by name
          </button>
        </div>
      </Panel>

      <Panel className="xl:col-span-2" title="Keywords" subtitle={`${config.keywords.filter((k) => k.active).length} active of ${config.keywords.length}`}>
        <div className="flex flex-col gap-2">
          <textarea
            value={newKeywords}
            onChange={(e) => setNewKeywords(e.target.value)}
            placeholder={"One keyword per line, e.g.\nhalong bay cruise\nbest time to visit halong bay"}
            rows={3}
            className="rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={addKeywords}
            className="self-end rounded-lg border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
          >
            Add keywords
          </button>
        </div>
        {config.keywords.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No keywords yet.
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {config.keywords.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-b-0" style={{ borderColor: "var(--gridline)" }}>
                <label className="flex min-w-0 flex-1 items-center gap-2" style={{ color: k.active ? "var(--text-primary)" : "var(--text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={k.active}
                    onChange={() =>
                      onSave({ ...config, keywords: config.keywords.map((x) => (x.id === k.id ? { ...x, active: !x.active } : x)) })
                    }
                  />
                  <span className="truncate">{k.keyword}</span>
                  {!k.active ? <span className="text-xs">(paused)</span> : null}
                </label>
                <button
                  type="button"
                  onClick={() => onSave({ ...config, keywords: config.keywords.filter((x) => x.id !== k.id) })}
                  className="text-xs"
                  style={{ color: "var(--status-critical)" }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
