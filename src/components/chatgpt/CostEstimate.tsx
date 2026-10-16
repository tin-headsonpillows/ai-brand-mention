"use client";

import { estimateRun, fmtUsd, modelLabel } from "@/lib/chatgpt/pricing";
import type { KeyRow, MentionsSettingsView } from "./settings";

/** The run's estimated cost and, with a real key, what that key has left of today's limit. */
export function CostEstimate({
  model,
  prompts,
  locations,
  keyId,
  keyLabel,
  hasUserKey,
  settings,
  onOpenSettings,
}: {
  model: string;
  prompts: number;
  locations: number;
  keyId: string;
  keyLabel: string;
  hasUserKey: boolean;
  settings: MentionsSettingsView | null;
  onOpenSettings: () => void;
}) {
  const estimate = estimateRun(model, prompts, locations);
  const mock = !hasUserKey && (settings?.mock ?? false);
  const key: KeyRow | undefined = settings?.keys.find((k) => k.id === keyId);
  const limit = key?.limitUsd ?? settings?.dailyLimitUsd ?? null;
  const spent = key?.spentTodayUsd ?? 0;
  const left = limit === null ? null : Math.max(0, limit - spent);
  const over = !mock && left !== null && estimate.totalUsd > left;
  const usedShare = limit ? Math.min(1, spent / limit) : 0;
  const runShare = limit ? Math.min(1 - usedShare, estimate.totalUsd / limit) : 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: over ? "var(--status-critical)" : "var(--border-hairline)", background: "var(--page-plane)" }} aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Estimated cost{" "}
          <span className="text-lg font-semibold tabular" style={{ color: "var(--text-primary)" }}>
            ≈ {fmtUsd(estimate.totalUsd)}
          </span>{" "}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {modelLabel(model)} · {estimate.calls} API calls
          </span>
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {estimate.parts.map((p) => `${p.label} ${fmtUsd(p.costUsd)}`).join(" · ")}
        </span>
      </div>
      {mock ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          No OpenAI key on the server or in the form, so this run uses simulated answers and costs nothing. With a key it would cost about this much.
        </p>
      ) : limit !== null ? (
        <div className="flex flex-col gap-1">
          <div className="flex h-2 overflow-hidden rounded" style={{ background: "var(--meter-track)" }} role="img" aria-label={`${fmtUsd(spent)} spent today, this run about ${fmtUsd(estimate.totalUsd)}, limit ${fmtUsd(limit)}`}>
            <span style={{ width: `${usedShare * 100}%`, background: "var(--series-1)" }} />
            {runShare > 0 ? <span style={{ width: 2, background: "var(--surface-1)" }} /> : null}
            <span style={{ width: `${runShare * 100}%`, background: over ? "var(--status-critical)" : "color-mix(in srgb, var(--series-1) 45%, transparent)" }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <span>
              {keyLabel}: {fmtUsd(spent)} spent today of the {fmtUsd(limit)} daily limit · {fmtUsd(left)} left
            </span>
            <button type="button" onClick={onOpenSettings} className="font-medium hover:underline" style={{ color: "var(--series-1)" }}>
              Change limit or model
            </button>
          </div>
          {over ? (
            <p className="text-xs font-medium" style={{ color: "var(--status-critical)" }}>
              This run would pass today&apos;s limit, so it won&apos;t start. Run fewer prompts, choose a cheaper model, or raise the limit.
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Based on typical answer lengths - real runs usually land within about 30%. The exact cost shows after the run.
      </p>
    </div>
  );
}
