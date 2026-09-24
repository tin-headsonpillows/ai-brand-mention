"use client";

import { useState } from "react";
import type { VisibilityTrendPoint } from "@/lib/tracking/aggregate";

interface VisibilityChartProps {
  points: VisibilityTrendPoint[];
}

interface Series {
  key: "organicPct" | "aiOverviewPct" | "aiModePct";
  label: string;
  color: string;
}

const SERIES: Series[] = [
  { key: "organicPct", label: "Organic results", color: "var(--series-1)" },
  { key: "aiOverviewPct", label: "AI Overview", color: "#eb6834" },
  { key: "aiModePct", label: "AI Mode", color: "#1baf7a" },
];

const WIDTH = 640;
const HEIGHT = 220;
const PAD_LEFT = 36;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

export function VisibilityChart({ points }: VisibilityChartProps) {
  const [view, setView] = useState<"chart" | "table">("chart");

  if (points.length === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No history yet - run tracking at least once to start the trend.
      </div>
    );
  }

  const innerWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xFor = (i: number) => PAD_LEFT + (points.length === 1 ? innerWidth / 2 : (i / (points.length - 1)) * innerWidth);
  const yFor = (pct: number) => PAD_TOP + innerHeight * (1 - pct);

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Visibility over time
        </h3>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setView("chart")}
            className="rounded px-2 py-1"
            style={{
              color: view === "chart" ? "var(--text-primary)" : "var(--text-muted)",
              background: view === "chart" ? "var(--gridline)" : "transparent",
            }}
          >
            Chart
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            className="rounded px-2 py-1"
            style={{
              color: view === "table" ? "var(--text-primary)" : "var(--text-muted)",
              background: view === "table" ? "var(--gridline)" : "transparent",
            }}
          >
            Table
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      {view === "chart" ? (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Visibility percentage over time">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(f)}
              y2={yFor(f)}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={PAD_LEFT - 8} y={yFor(f) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              {Math.round(f * 100)}%
            </text>
          ))}

          {SERIES.map((s) => {
            const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p[s.key])}`).join(" ");
            const last = points[points.length - 1];
            return (
              <g key={s.key}>
                <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={xFor(points.length - 1)} cy={yFor(last[s.key])} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                <text
                  x={Math.min(xFor(points.length - 1) + 6, WIDTH - PAD_RIGHT - 2)}
                  y={yFor(last[s.key]) + 3}
                  fontSize={10}
                  fill="var(--text-secondary)"
                >
                  {Math.round(last[s.key] * 100)}%
                </text>
              </g>
            );
          })}

          {points.map((p, i) =>
            i === 0 || i === points.length - 1 || points.length <= 6 ? (
              <text key={p.date} x={xFor(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                {p.date.slice(5)}
              </text>
            ) : null
          )}
        </svg>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--gridline)" }}>
              <th className="py-1 font-medium" style={{ color: "var(--text-secondary)" }}>
                Date
              </th>
              {SERIES.map((s) => (
                <th key={s.key} className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                  {s.label}
                </th>
              ))}
              <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                Keywords
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className="border-b" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-1.5" style={{ color: "var(--text-primary)" }}>
                  {p.date}
                </td>
                {SERIES.map((s) => (
                  <td key={s.key} className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                    {Math.round(p[s.key] * 100)}%
                  </td>
                ))}
                <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                  {p.keywordCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
