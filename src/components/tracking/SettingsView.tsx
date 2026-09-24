"use client";

import { useState } from "react";
import type { TrackedCompetitor, TrackingConfig } from "@/lib/tracking/types";
import { Favicon } from "./Favicon";
import { Panel, inputStyle } from "./ui";

interface SettingsViewProps {
  config: TrackingConfig;
  onDraftChange: (next: TrackingConfig) => void;
  onSave: (next: TrackingConfig) => void;
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

export function SettingsView({ config, onDraftChange, onSave }: SettingsViewProps) {
  const [newKeywords, setNewKeywords] = useState("");
  const [newExcluded, setNewExcluded] = useState("");

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

  const addExcluded = () => {
    const domains = newExcluded
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
      .filter((d) => d && !config.excludedDomains.includes(d));
    if (domains.length === 0) return;
    onSave({ ...config, excludedDomains: [...config.excludedDomains, ...domains] });
    setNewExcluded("");
  };

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
        subtitle="Applied retroactively to history you've already collected"
        className="xl:col-span-2"
        actions={
          <button
            type="button"
            onClick={() =>
              onDraftChange({
                ...config,
                competitors: [...config.competitors, { id: crypto.randomUUID(), name: "", aliases: [], website: "" }],
              })
            }
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
            style={{ background: "var(--series-1)" }}
          >
            + Add competitor
          </button>
        }
      >
        {config.competitors.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No competitors yet. Add the brands you actually compete with - rankings, share of voice and the rank tracker
            will compare you against exactly these.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div
              className="hidden grid-cols-[28px_1fr_1fr_1fr_auto] gap-2 px-1 text-xs sm:grid"
              style={{ color: "var(--text-muted)" }}
            >
              <span />
              <span>Name</span>
              <span>Aliases (comma-separated)</span>
              <span>Website</span>
              <span className="w-14" />
            </div>
            {config.competitors.map((c) => (
              <div key={c.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[28px_1fr_1fr_1fr_auto]">
                <span className="hidden sm:block">
                  <Favicon domain={c.website} label={c.name} size={20} />
                </span>
                <input
                  value={c.name}
                  onChange={(e) => updateCompetitor(c.id, { name: e.target.value })}
                  onBlur={() => onSave(config)}
                  placeholder="Competitor name"
                  aria-label="Competitor name"
                  className="rounded-lg border px-2.5 py-2 text-sm"
                  style={inputStyle}
                />
                <input
                  value={c.aliases.join(", ")}
                  onChange={(e) => updateCompetitor(c.id, { aliases: splitAliases(e.target.value) })}
                  onBlur={() => onSave(config)}
                  placeholder="Other names"
                  aria-label="Competitor aliases"
                  className="rounded-lg border px-2.5 py-2 text-sm"
                  style={inputStyle}
                />
                <input
                  value={c.website}
                  onChange={(e) => updateCompetitor(c.id, { website: e.target.value })}
                  onBlur={() => onSave(config)}
                  placeholder="competitor.com"
                  aria-label="Competitor website"
                  className="rounded-lg border px-2.5 py-2 text-sm"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => onSave({ ...config, competitors: config.competitors.filter((x) => x.id !== c.id) })}
                  className="w-14 text-xs"
                  style={{ color: "var(--status-critical)" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Keywords" subtitle={`${config.keywords.filter((k) => k.active).length} active of ${config.keywords.length}`}>
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

      <Panel title="Excluded domains" subtitle="Blogs, OTAs and forums hidden from Cited websites">
        <div className="flex gap-2">
          <input
            value={newExcluded}
            onChange={(e) => setNewExcluded(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExcluded();
              }
            }}
            placeholder="tripadvisor.com, reddit.com"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={addExcluded}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
          >
            Exclude
          </button>
        </div>
        {config.excludedDomains.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing excluded. You can also click &quot;Hide&quot; on any row in Mentions &amp; Citations.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {config.excludedDomains.map((d) => (
              <span
                key={d}
                className="flex items-center gap-1.5 rounded-full border py-1 pl-2 pr-1 text-xs"
                style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
              >
                <Favicon domain={d} size={14} />
                {d}
                <button
                  type="button"
                  onClick={() => onSave({ ...config, excludedDomains: config.excludedDomains.filter((x) => x !== d) })}
                  aria-label={`Stop excluding ${d}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ color: "var(--text-muted)" }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
