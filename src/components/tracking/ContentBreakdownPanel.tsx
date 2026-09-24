"use client";

import type { ContentBreakdown, SurfaceBreakdown } from "@/lib/tracking/types";

const SURFACES: Array<{ key: keyof ContentBreakdown; label: string; color: string }> = [
  { key: "organic", label: "Organic results", color: "var(--series-1)" },
  { key: "aiOverview", label: "AI Overview", color: "#eb6834" },
  { key: "aiMode", label: "AI Mode", color: "#1baf7a" },
];

function pct(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "-";
}

function SurfaceCard({ label, color, data }: { label: string; color: string; data: SurfaceBreakdown }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: "var(--gridline)" }}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
          {label}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <dt style={{ color: "var(--text-muted)" }}>Shown</dt>
        <dd className="text-right tabular" style={{ color: "var(--text-primary)" }}>
          {pct(data.presentDays, data.totalKeywordDays)}
        </dd>
        <dt style={{ color: "var(--text-muted)" }}>Brand visible</dt>
        <dd className="text-right tabular font-medium" style={{ color: "var(--text-primary)" }}>
          {pct(data.brandMatchedDays, data.totalKeywordDays)}
        </dd>
        {data.avgOrganicPosition != null ? (
          <>
            <dt style={{ color: "var(--text-muted)" }}>Avg. position</dt>
            <dd className="text-right tabular" style={{ color: "var(--text-primary)" }}>
              #{data.avgOrganicPosition.toFixed(1)}
            </dd>
          </>
        ) : null}
        <dt style={{ color: "var(--text-muted)" }}>By name</dt>
        <dd className="text-right tabular" style={{ color: "var(--text-primary)" }}>
          {data.matchedByName}
        </dd>
        <dt style={{ color: "var(--text-muted)" }}>By alias</dt>
        <dd className="text-right tabular" style={{ color: "var(--text-primary)" }}>
          {data.matchedByAlias}
        </dd>
        <dt style={{ color: "var(--text-muted)" }}>As cited source</dt>
        <dd className="text-right tabular" style={{ color: "var(--text-primary)" }}>
          {data.matchedByWebsite}
        </dd>
      </dl>
    </div>
  );
}

export function ContentBreakdownPanel({ breakdown }: { breakdown: ContentBreakdown }) {
  const hasData = SURFACES.some((s) => breakdown[s.key].totalKeywordDays > 0);
  if (!hasData) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No content breakdown yet - run tracking at least once.
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Content breakdown by surface
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          How often each surface renders at all, and how your brand shows up in it, across every tracked
          keyword-day.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SURFACES.map((s) => (
          <SurfaceCard key={s.key} label={s.label} color={s.color} data={breakdown[s.key]} />
        ))}
      </div>
    </div>
  );
}
