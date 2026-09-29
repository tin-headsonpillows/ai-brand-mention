"use client";

import { useState } from "react";
import type { AnalysisMode, AnalyzeRequestBody } from "@/lib/types";
import { LOCATION_PLACEHOLDER, regionalPrompt, splitCount } from "@/lib/locations";
import { LocationsInput, addLocations } from "@/components/LocationsInput";
import { Segmented, Switch } from "@/components/tracking/ui";

interface AnalyzeFormProps {
  running: boolean;
  onSubmit: (body: AnalyzeRequestBody) => void;
  onStop: () => void;
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  borderColor: "var(--border-hairline)",
};

const MODE_OPTIONS: Array<{ value: AnalysisMode; label: string }> = [
  { value: "market", label: "Regional market" },
  { value: "brand", label: "Brand awareness" },
];

const MODE_DESCRIPTION: Record<AnalysisMode, string> = {
  market: "Find which businesses ChatGPT recommends most in each location - no brand needed.",
  brand: "Measure how often your brand gets recommended, overall and in each location.",
};

export function AnalyzeForm({ running, onSubmit, onStop }: AnalyzeFormProps) {
  const [mode, setMode] = useState<AnalysisMode>("market");
  const [seedPrompt, setSeedPrompt] = useState("Top beachfront hotel");
  const [locations, setLocations] = useState<string[]>(["Da Nang"]);
  const [locationDraft, setLocationDraft] = useState("");
  const [compareLocal, setCompareLocal] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [brandAliases, setBrandAliases] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [variationCount, setVariationCount] = useState(100);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [model, setModel] = useState("");
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  // Deliberately plain component state - never written to localStorage, sessionStorage,
  // or cookies, so these are wiped whenever the page reloads and must be re-entered.
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [serpApiKey, setSerpApiKey] = useState("");

  // A location still sitting in the text field counts - people often type one and press Run straight away.
  const effectiveLocations = addLocations(locations, locationDraft);
  const perLocation = splitCount(variationCount, effectiveLocations.length);
  const usesPlaceholder = seedPrompt.includes(LOCATION_PLACEHOLDER);
  const previews = effectiveLocations.map((loc) => ({ loc, prompt: regionalPrompt(seedPrompt, loc, effectiveLocations) }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!seedPrompt.trim()) return;
    if (mode === "brand" && !brand.trim()) {
      setFormError("Enter your brand name, or switch to Regional market.");
      return;
    }
    if (usesPlaceholder && effectiveLocations.length === 0) {
      setFormError(`Your prompt uses ${LOCATION_PLACEHOLDER} - add at least one location to fill it in.`);
      return;
    }
    setFormError(null);
    setLocations(effectiveLocations);
    setLocationDraft("");
    onSubmit({
      mode,
      seedPrompt: seedPrompt.trim(),
      brand: mode === "brand" ? brand.trim() : undefined,
      brandAliases: mode === "brand" ? brandAliases.trim() || undefined : undefined,
      competitors: mode === "brand" ? competitors.trim() || undefined : undefined,
      variationCount,
      model: model.trim() || undefined,
      locations: effectiveLocations,
      compareLocal: effectiveLocations.length > 0 && compareLocal,
      localSearchQuery: localSearchQuery.trim() || undefined,
      openaiApiKey: openaiApiKey.trim() || undefined,
      serpApiKey: serpApiKey.trim() || undefined,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={mode} options={MODE_OPTIONS} onChange={setMode} ariaLabel="Analysis mode" />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {MODE_DESCRIPTION[mode]}
        </span>
      </div>

      <div
        className="flex flex-col gap-3 rounded-lg border p-3"
        style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)" }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Your API keys
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Kept in your browser for this session only - sent directly with each request, never stored on our
            server, and cleared when you reload the page. Re-enter them each time you come back.
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="openaiApiKey" className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              OpenAI API key <span style={{ color: "var(--text-muted)" }}>(optional)</span>
            </label>
            <input
              id="openaiApiKey"
              type="password"
              autoComplete="off"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              placeholder="sk-... (falls back to mock mode if empty)"
              className="rounded border px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="serpApiKey" className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              SerpApi key <span style={{ color: "var(--text-muted)" }}>(optional)</span>
            </label>
            <input
              id="serpApiKey"
              type="password"
              autoComplete="off"
              value={serpApiKey}
              onChange={(e) => setSerpApiKey(e.target.value)}
              placeholder="only needed for local results comparison"
              className="rounded border px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="seedPrompt" className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Prompt
          </label>
          <textarea
            id="seedPrompt"
            value={seedPrompt}
            onChange={(e) => setSeedPrompt(e.target.value)}
            rows={2}
            required
            placeholder="e.g. top beachfront hotel"
            className="rounded border px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="locations" className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Locations{" "}
            <span className="font-normal" style={{ color: "var(--text-muted)" }}>
              (each gets its own prompts and leaderboard)
            </span>
          </label>
          <LocationsInput
            id="locations"
            locations={locations}
            draft={locationDraft}
            onChange={setLocations}
            onDraftChange={setLocationDraft}
            disabled={running}
          />
          {previews.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
              {previews.slice(0, 4).map(({ loc, prompt }) => (
                <li key={loc} className="flex gap-1.5">
                  <span className="shrink-0 font-medium" style={{ color: "var(--text-primary)" }}>
                    {loc}:
                  </span>
                  <span className="truncate">&ldquo;{prompt}&rdquo;</span>
                </li>
              ))}
              {previews.length > 4 ? <li style={{ color: "var(--text-muted)" }}>+{previews.length - 4} more</li> : null}
            </ul>
          ) : null}
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {effectiveLocations.length === 0
              ? "Leave empty to run the prompt as written. "
              : "Your prompt is rewritten for each location, and ChatGPT generates variations that stay in that place. "}
            Write the place as <code>{LOCATION_PLACEHOLDER}</code> to control where it goes; a prompt that names one of
            these locations has it swapped for each of the others.
          </p>
        </div>
      </div>

      {mode === "brand" ? (
        <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="brand" className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Your brand name
          </label>
          <input
            id="brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="e.g. Furama Resort"
            className="rounded border px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="brandAliases" className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Brand aliases <span style={{ color: "var(--text-muted)" }}>(optional)</span>
          </label>
          <input
            id="brandAliases"
            value={brandAliases}
            onChange={(e) => setBrandAliases(e.target.value)}
            placeholder="comma-separated, e.g. Furama Danang"
            className="rounded border px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="competitors" className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Competitors to compare <span style={{ color: "var(--text-muted)" }}>(optional, comma-separated)</span>
        </label>
        <input
          id="competitors"
          value={competitors}
          onChange={(e) => setCompetitors(e.target.value)}
          placeholder="e.g. InterContinental Danang, Fusion Resort, Hyatt Regency Danang"
          className="rounded border px-3 py-2 text-sm outline-none"
          style={inputStyle}
        />
      </div>
        </>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="variationCount" className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Number of prompts to run
          </label>
          <span className="tabular text-sm" style={{ color: "var(--text-secondary)" }}>
            {variationCount}
          </span>
        </div>
        <input
          id="variationCount"
          type="range"
          min={5}
          max={100}
          step={5}
          value={variationCount}
          onChange={(e) => setVariationCount(Number(e.target.value))}
          disabled={running}
        />
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {effectiveLocations.length > 1
            ? `Split across ${effectiveLocations.length} locations: ${
                perLocation[0] === perLocation[perLocation.length - 1]
                  ? perLocation[0]
                  : `${perLocation[perLocation.length - 1]}-${perLocation[0]}`
              } prompts each. `
            : ""}
          Each prompt is one call to the ChatGPT API. Lower this while testing to control cost.
        </p>
      </div>

      {effectiveLocations.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Switch
            checked={compareLocal}
            onChange={setCompareLocal}
            label="Compare each location with Google Local & Maps results"
          />
          <p className="pl-9 text-xs" style={{ color: "var(--text-muted)" }}>
            2 SerpApi searches per location, run after ChatGPT finishes.
          </p>
        </div>
      ) : null}

      <details open={showAdvanced} onToggle={(e) => setShowAdvanced(e.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Advanced options
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="model" className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              Model override
            </label>
            <input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="defaults to gpt-4o-mini (or OPENAI_MODEL)"
              className="rounded border px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="localSearchQuery" className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              Local search query override
            </label>
            <input
              id="localSearchQuery"
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              placeholder={`defaults to the prompt above; ${LOCATION_PLACEHOLDER} works here too`}
              className="rounded border px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
        </div>
      </details>

      {formError ? (
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          {formError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={running}
          className="rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--series-1)" }}
        >
          {running ? "Running..." : "Run analysis"}
        </button>
        {running ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded border px-4 py-2 text-sm font-semibold"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
          >
            Stop
          </button>
        ) : null}
      </div>
    </form>
  );
}
