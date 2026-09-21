"use client";

import { useState } from "react";
import type { AnalyzeRequestBody } from "@/lib/types";

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

export function AnalyzeForm({ running, onSubmit, onStop }: AnalyzeFormProps) {
  const [seedPrompt, setSeedPrompt] = useState("Best hotel for a family in Da Nang");
  const [brand, setBrand] = useState("");
  const [brandAliases, setBrandAliases] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [variationCount, setVariationCount] = useState(100);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [model, setModel] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!seedPrompt.trim() || !brand.trim()) return;
    onSubmit({
      seedPrompt: seedPrompt.trim(),
      brand: brand.trim(),
      brandAliases: brandAliases.trim() || undefined,
      competitors: competitors.trim() || undefined,
      variationCount,
      model: model.trim() || undefined,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seedPrompt" className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Example prompt
        </label>
        <textarea
          id="seedPrompt"
          value={seedPrompt}
          onChange={(e) => setSeedPrompt(e.target.value)}
          rows={2}
          required
          placeholder="e.g. best hotel for family in Da Nang"
          className="rounded border px-3 py-2 text-sm outline-none"
          style={inputStyle}
        />
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          ChatGPT will generate {variationCount} realistic variations of this question, then answer each one.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="brand" className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Your brand name
          </label>
          <input
            id="brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            required
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
          Each prompt is one call to the ChatGPT API. Lower this while testing to control cost.
        </p>
      </div>

      <details open={showAdvanced} onToggle={(e) => setShowAdvanced(e.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Advanced options
        </summary>
        <div className="mt-2 flex flex-col gap-1.5">
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
      </details>

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
