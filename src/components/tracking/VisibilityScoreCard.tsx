"use client";

import type { SubjectDailyPoint } from "@/lib/tracking/types";

const WIDTH = 280;
const HEIGHT = 56;

function sparklinePath(points: SubjectDailyPoint[]): string {
  if (points.length === 0) return "";
  const max = Math.max(...points.map((p) => p.visibilityPct), 0.01);
  const stepX = points.length > 1 ? WIDTH / (points.length - 1) : 0;
  return points
    .map((p, i) => {
      const x = points.length > 1 ? i * stepX : WIDTH / 2;
      const y = HEIGHT - (p.visibilityPct / max) * (HEIGHT - 6) - 3;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function VisibilityScoreCard({ points }: { points: SubjectDailyPoint[] }) {
  const latest = points[points.length - 1] ?? null;
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const currentPct = latest ? Math.round(latest.visibilityPct * 100) : null;
  const deltaPct = latest && previous ? Math.round((latest.visibilityPct - previous.visibilityPct) * 100) : null;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Visibility score
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Share of tracked keywords where your brand appeared in any surface.
        </p>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular" style={{ color: "var(--text-primary)" }}>
          {currentPct != null ? `${currentPct}%` : "-"}
        </span>
        {deltaPct != null && deltaPct !== 0 ? (
          <span
            className="text-sm font-medium tabular"
            style={{ color: deltaPct > 0 ? "var(--success-text)" : "var(--status-critical)" }}
          >
            {deltaPct > 0 ? "+" : ""}
            {deltaPct}%
          </span>
        ) : null}
      </div>

      {points.length > 1 ? (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-10 w-full" role="img" aria-label="Visibility score trend">
          <path d={sparklinePath(points)} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Run tracking a few more days to see the trend.
        </p>
      )}
    </div>
  );
}
