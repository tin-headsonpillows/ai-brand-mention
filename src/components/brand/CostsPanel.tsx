"use client";

import { useState } from "react";
import type { CostReport } from "@/lib/brand/costs";
import { PLATFORMS, PLATFORM_LABEL, type BrandSettings, type Platform } from "@/lib/brand/types";
import { Panel, Switch } from "@/components/tracking/ui";
import { PlatformIcon } from "./BrandCards";

const usd = (v: number) => (v < 0.1 && v > 0 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);
const field: React.CSSProperties = { borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" };

export function CostsPanel({
  costs,
  settings,
  onSave,
}: {
  costs: CostReport;
  settings: BrandSettings;
  onSave: (patch: Partial<BrandSettings> & { dailyLimitUsd?: number }) => Promise<void>;
}) {
  const [limit, setLimit] = useState(String(costs.limit));
  const [saving, setSaving] = useState(false);
  const usedPct = costs.limit > 0 ? Math.min(100, (costs.today.totalUsd / costs.limit) * 100) : 100;
  const save = async (patch: Partial<BrandSettings> & { dailyLimitUsd?: number }) => {
    setSaving(true);
    try {
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  };
  const maxRecent = Math.max(costs.limit, ...costs.recent.map((d) => d.totalUsd), 0.01);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="Daily spending limit" subtitle="ChatGPT + Claude + analysis, shared by all projects (UTC day)">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Spent today
            </span>
            <span className="tabular text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {usd(costs.today.totalUsd)}
              <span className="text-base font-normal" style={{ color: "var(--text-muted)" }}>
                {" "}
                of {usd(costs.limit)}
              </span>
            </span>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              OpenAI {usd(costs.today.byProvider.openai)} · Anthropic {usd(costs.today.byProvider.anthropic)} · {costs.today.calls} calls
            </span>
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(limit);
              if (Number.isFinite(v) && v >= 0) void save({ dailyLimitUsd: v });
            }}
          >
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Limit (USD / day)
              <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="w-24 rounded-lg border px-2 py-1.5 text-sm outline-none" style={field} />
            </label>
            <button type="submit" disabled={saving || Number(limit) === costs.limit} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: "var(--series-1)" }}>
              Save
            </button>
          </form>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--meter-track)" }} role="img" aria-label={`${Math.round(usedPct)}% of today's limit used`}>
          <div className="h-full rounded-full" style={{ width: `${usedPct}%`, background: usedPct >= 90 ? "var(--status-critical)" : "var(--series-1)" }} />
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          When the limit is reached, runs pause and continue automatically the next day. SerpApi credits (Google AI Mode / AI Overview) are separate and not counted here.
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Last 14 days
          </span>
          <div className="flex h-16 items-end gap-1" role="img" aria-label="Daily spend, last 14 days">
            {costs.recent.map((d) => (
              <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end" title={`${d.day}: ${usd(d.totalUsd)}`}>
                <div className="w-full rounded-t" style={{ height: `${Math.max(2, (d.totalUsd / maxRecent) * 100)}%`, background: d.totalUsd ? "var(--series-1)" : "var(--gridline)" }} />
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Projected cost" subtitle={`${costs.promptCount} active prompts × ${costs.platforms.length} platforms, weekly`}>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Per run", value: costs.perRun.total },
            { label: "Per week", value: costs.perWeek },
            { label: "Per month", value: costs.perMonth },
          ].map((s) => (
            <div key={s.label} className="flex flex-col rounded-lg border px-3 py-2" style={{ borderColor: "var(--border-hairline)" }}>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {s.label}
              </span>
              <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                {usd(s.value)}
              </span>
            </div>
          ))}
        </div>
        <table className="w-full text-xs">
          <tbody>
            {[
              { label: `ChatGPT (${settings.chatgptModel})`, value: costs.perRun.chatgpt, basis: costs.basis.chatgpt, on: settings.platforms.chatgpt },
              { label: `Claude (${settings.claudeModel})`, value: costs.perRun.claude, basis: costs.basis.claude, on: settings.platforms.claude },
              { label: "Answer analysis (OpenAI)", value: costs.perRun.analysis, basis: "estimate" as const, on: true },
            ].map((r) => (
              <tr key={r.label} className="border-t" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", opacity: r.on ? 1 : 0.5 }}>
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5 text-right" style={{ color: "var(--text-muted)" }}>
                  {r.on ? (r.basis === "observed" ? "from last run" : "estimate") : "off"}
                </td>
                <td className="tabular py-1.5 text-right" style={{ color: "var(--text-primary)" }}>
                  {usd(r.value)}
                </td>
              </tr>
            ))}
            <tr className="border-t" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
              <td className="py-1.5">SerpApi (AI Mode + AI Overview)</td>
              <td />
              <td className="tabular py-1.5 text-right" style={{ color: "var(--text-primary)" }}>
                {costs.perRun.serpCredits} credits / run
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {costs.runsLeftToday !== null && costs.perRun.total > costs.limit
            ? `One run costs more than the daily limit, so each run spreads over about ${Math.ceil(costs.perRun.total / Math.max(0.01, costs.limit))} days.`
            : costs.runsLeftToday !== null
              ? `Today's remaining budget covers about ${costs.runsLeftToday.toFixed(1)} runs.`
              : ""}{" "}
          Estimates use typical web-search answers (search results count as input tokens); after a run they switch to the real average cost.
        </p>
      </Panel>

      <Panel title="Platforms & schedule">
        <div className="flex flex-col gap-3">
          {PLATFORMS.map((p: Platform) => (
            <div key={p} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm" style={{ color: "var(--text-primary)" }}>
                <PlatformIcon platform={p} />
                {PLATFORM_LABEL[p]}
                {costs.mock[p] ? (
                  <span className="text-[11px]" style={{ color: "var(--status-serious)" }}>
                    placeholder data (no API key)
                  </span>
                ) : null}
              </span>
              <Switch checked={settings.platforms[p]} onChange={(v) => void save({ platforms: { ...settings.platforms, [p]: v } })} label={`Track ${PLATFORM_LABEL[p]}`} />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--border-hairline)" }}>
            <span className="text-sm" style={{ color: "var(--text-primary)" }}>
              Run automatically every week
            </span>
            <Switch checked={settings.schedule === "weekly"} onChange={(v) => void save({ schedule: v ? "weekly" : "off" })} label="Weekly schedule" />
          </div>
        </div>
      </Panel>

      <Panel title="Models" subtitle="projected per run with your current prompts">
        {(["openai", "anthropic"] as const).map((provider) => (
          <div key={provider} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              {provider === "openai" ? "ChatGPT (OpenAI, with web search)" : "Claude (Anthropic, with web search)"}
            </span>
            {costs.models
              .filter((m) => m.provider === provider)
              .map((m) => {
                const current = provider === "openai" ? settings.chatgptModel === m.id : settings.claudeModel === m.id;
                return (
                  <label key={m.id} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: current ? "var(--series-1)" : "var(--border-hairline)" }}>
                    <span className="flex items-start gap-2">
                      <input type="radio" name={provider} checked={current} onChange={() => void save(provider === "openai" ? { chatgptModel: m.id } : { claudeModel: m.id })} className="mt-1" />
                      <span className="flex flex-col">
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {m.label}
                        </span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {m.note}
                        </span>
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-right text-xs" style={{ color: "var(--text-secondary)" }}>
                      ≈{usd(m.perAnswer)}/answer
                      <br />
                      {usd(m.perRun)}/run · {usd(m.perMonth)}/mo
                    </span>
                  </label>
                );
              })}
          </div>
        ))}
      </Panel>
    </div>
  );
}
