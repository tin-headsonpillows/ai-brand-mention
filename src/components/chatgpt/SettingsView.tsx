"use client";

import { useState } from "react";
import { MENTIONS_MODELS, SERVER_KEY_ID, estimateRun, fmtPrice, fmtUsd, modelLabel, modelPrice } from "@/lib/chatgpt/pricing";
import { Panel } from "@/components/tracking/ui";
import type { KeyRow, MentionsSettingsView, SettingsUpdate } from "./settings";

const inputStyle: React.CSSProperties = { background: "var(--surface-1)", color: "var(--text-primary)", borderColor: "var(--border-hairline)" };

function parseUsd(text: string): number | null {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

export function SettingsView({ settings, save }: { settings: MentionsSettingsView | null; save: (update: SettingsUpdate) => Promise<unknown> }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [custom, setCustom] = useState("");
  const [limitDraft, setLimitDraft] = useState<string | null>(null);

  if (!settings) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading settings...
      </p>
    );
  }

  const current = settings.model ?? settings.serverDefaultModel;
  const isListed = MENTIONS_MODELS.some((m) => m.id === current);

  async function apply(update: SettingsUpdate, done: string) {
    try {
      await save(update);
      setMessage({ text: done, error: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Couldn't save", error: true });
    }
  }

  const limitText = limitDraft ?? String(settings.dailyLimitUsd);

  return (
    <div className="flex flex-col gap-4">
      {message ? (
        <p className="rounded-lg border px-3 py-2 text-sm" role="status" style={{ borderColor: message.error ? "var(--status-critical)" : "var(--border-hairline)", color: message.error ? "var(--status-critical)" : "var(--text-secondary)" }}>
          {message.text}
        </p>
      ) : null}

      <Panel title="Model" subtitle="used for new runs unless you pick another in the run form">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Default model">
          {MENTIONS_MODELS.map((m) => {
            const p = modelPrice(m.id);
            const selected = current === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void apply({ model: m.id }, `${m.label} is now the default model.`)}
                className="flex flex-col gap-1 rounded-lg border p-3 text-left"
                style={{
                  borderColor: selected ? "var(--series-1)" : "var(--border-hairline)",
                  background: selected ? "color-mix(in srgb, var(--series-1) 7%, var(--surface-1))" : "var(--surface-1)",
                  boxShadow: selected ? "0 0 0 1px var(--series-1)" : undefined,
                }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {m.label}
                  </span>
                  {selected ? (
                    <span className="text-xs font-medium" style={{ color: "var(--series-1)" }}>
                      ✓ Default
                    </span>
                  ) : null}
                </span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {m.note}
                </span>
                <span className="text-xs tabular" style={{ color: "var(--text-muted)" }}>
                  {fmtPrice(p.input)} in · {fmtPrice(p.output)} out per 1M tokens · 100 prompts ≈ {fmtUsd(estimateRun(m.id, 100, 1).totalUsd)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={isListed ? "Other model ID, e.g. gpt-4.1" : current}
            aria-label="Other model ID"
            className="w-56 rounded border px-3 py-1.5 text-sm outline-none"
            style={inputStyle}
          />
          <button
            type="button"
            disabled={!custom.trim()}
            onClick={() => void apply({ model: custom.trim() }, `${custom.trim()} is now the default model.`).then(() => setCustom(""))}
            className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
          >
            Use this model
          </button>
          {settings.model ? (
            <button type="button" onClick={() => void apply({ model: null }, "Back to the server default model.")} className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
              Reset to server default ({modelLabel(settings.serverDefaultModel)})
            </button>
          ) : null}
        </div>
        {!isListed ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Current default: {current}. Models not in the list are estimated and limited at flagship prices.
          </p>
        ) : null}
      </Panel>

      <Panel title="Daily spending limits" subtitle="per OpenAI API key · resets at midnight UTC">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--text-primary)" }}>
            Default limit for every key (USD per day)
            <input value={limitText} onChange={(e) => setLimitDraft(e.target.value)} inputMode="decimal" className="w-32 rounded border px-3 py-1.5 text-sm outline-none" style={inputStyle} />
          </label>
          <button
            type="button"
            disabled={parseUsd(limitText) === null || parseUsd(limitText) === settings.dailyLimitUsd}
            onClick={() => {
              const v = parseUsd(limitText);
              if (v !== null) void apply({ dailyLimitUsd: v }, `Default daily limit set to ${fmtUsd(v)}.`).then(() => setLimitDraft(null));
            }}
            className="rounded px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--series-1)" }}
          >
            Save
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Before each call, its worst-case cost is checked against what the key has left today; a run that would pass the limit doesn&apos;t start, and one that reaches it stops. Set 0 to block a key.
        </p>
        {settings.keys.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="py-1.5 pr-3 text-left font-medium">Key</th>
                  <th className="py-1.5 pr-3 text-left font-medium">Last used</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Spent today</th>
                  <th className="py-1.5 pr-3 text-left font-medium">Own limit</th>
                  <th className="py-1.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {settings.keys.map((k) => (
                  <KeyLimitRow key={k.id} row={k} defaultLimit={settings.dailyLimitUsd} apply={apply} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Keys appear here after their first run.
          </p>
        )}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          A key typed into the run form is never stored - only a fingerprint (a hash) and its last 4 characters, so its spend and limit can be tracked.
          {settings.serverKey ? "" : " No OpenAI key is configured on the server, so runs without a key in the form use simulated answers."}
        </p>
      </Panel>
    </div>
  );
}

function KeyLimitRow({ row, defaultLimit, apply }: { row: KeyRow; defaultLimit: number; apply: (u: SettingsUpdate, done: string) => Promise<void> }) {
  const [draft, setDraft] = useState(row.ownLimitUsd === null ? "" : String(row.ownLimitUsd));
  const parsed = parseUsd(draft);
  const changed = draft.trim() === "" ? row.ownLimitUsd !== null : parsed !== null && parsed !== row.ownLimitUsd;
  const share = row.limitUsd > 0 ? Math.min(1, row.spentTodayUsd / row.limitUsd) : 1;
  return (
    <tr className="border-t align-middle" style={{ borderColor: "var(--gridline)" }}>
      <td className="py-2 pr-3 font-medium" style={{ color: "var(--text-primary)" }}>
        {row.label}
      </td>
      <td className="py-2 pr-3" style={{ color: "var(--text-secondary)" }}>
        {row.lastUsed ? new Date(row.lastUsed).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "–"}
      </td>
      <td className="py-2 pr-3 text-right tabular" style={{ color: share >= 1 ? "var(--status-critical)" : "var(--text-primary)" }}>
        {fmtUsd(row.spentTodayUsd)} / {fmtUsd(row.limitUsd)}
      </td>
      <td className="py-2 pr-3">
        <span className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            inputMode="decimal"
            placeholder={`default ${fmtUsd(defaultLimit)}`}
            aria-label={`Daily limit for ${row.label}`}
            className="w-28 rounded border px-2 py-1 text-xs outline-none"
            style={inputStyle}
          />
          <button
            type="button"
            disabled={!changed || (draft.trim() !== "" && parsed === null)}
            onClick={() =>
              void apply(
                { keyLimit: { id: row.id, limitUsd: draft.trim() === "" ? null : parsed } },
                draft.trim() === "" ? `${row.label} now uses the default limit.` : `${row.label}: daily limit set to ${fmtUsd(parsed)}.`
              )
            }
            className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-40"
            style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
          >
            Save
          </button>
        </span>
      </td>
      <td className="py-2 text-right">
        {row.id !== SERVER_KEY_ID ? (
          <button type="button" onClick={() => void apply({ forgetKey: row.id }, `${row.label} removed from the list (its usage history stays).`)} className="text-xs hover:underline" style={{ color: "var(--text-muted)" }}>
            Remove
          </button>
        ) : null}
      </td>
    </tr>
  );
}
