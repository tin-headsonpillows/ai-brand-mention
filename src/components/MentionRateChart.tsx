"use client";

import { useState } from "react";

export interface MentionRateRow {
  name: string;
  mentionRate: number;
  mentionCount: number;
  totalOccurrences: number;
  isBrand: boolean;
}

interface MentionRateChartProps {
  rows: MentionRateRow[];
  completed: number;
}

function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function MentionRateChart({ rows, completed }: MentionRateChartProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const sorted = [...rows].sort((a, b) => b.mentionRate - a.mentionRate);
  const maxRate = Math.max(0.01, ...sorted.map((r) => r.mentionRate));

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Mention rate by brand
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

      {view === "chart" ? (
        <div className="flex flex-col gap-3">
          {sorted.map((row) => (
            <div key={row.name} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: row.isBrand ? "var(--series-1)" : "var(--de-emphasis)" }}
                  />
                  {row.name}
                  {row.isBrand ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                    >
                      your brand
                    </span>
                  ) : null}
                </span>
                <span className="tabular" style={{ color: "var(--text-secondary)" }}>
                  {formatPct(row.mentionRate)} ({row.mentionCount}/{completed})
                </span>
              </div>
              <div className="h-6 w-full rounded" style={{ background: "var(--page-plane)" }}>
                <div
                  className="h-6 rounded"
                  style={{
                    width: `${Math.max(2, (row.mentionRate / maxRate) * 100)}%`,
                    background: row.isBrand ? "var(--series-1)" : "var(--de-emphasis)",
                    borderTopRightRadius: 4,
                    borderBottomRightRadius: 4,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--gridline)" }}>
              <th className="py-1 font-medium" style={{ color: "var(--text-secondary)" }}>
                Name
              </th>
              <th className="py-1 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                Mention rate
              </th>
              <th className="py-1 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                Prompts mentioning
              </th>
              <th className="py-1 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                Total occurrences
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.name} className="border-b" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-1.5" style={{ color: "var(--text-primary)" }}>
                  {row.name}
                  {row.isBrand ? " (your brand)" : ""}
                </td>
                <td className="py-1.5 tabular" style={{ color: "var(--text-primary)" }}>
                  {formatPct(row.mentionRate)}
                </td>
                <td className="py-1.5 tabular" style={{ color: "var(--text-primary)" }}>
                  {row.mentionCount} / {completed}
                </td>
                <td className="py-1.5 tabular" style={{ color: "var(--text-primary)" }}>
                  {row.totalOccurrences}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
