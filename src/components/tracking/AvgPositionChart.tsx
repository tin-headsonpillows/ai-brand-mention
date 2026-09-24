"use client";

import { useState } from "react";
import type { SubjectTrend } from "@/lib/tracking/types";

const WIDTH = 640;
const HEIGHT = 240;
const PAD_LEFT = 32;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function colorFor(slot: number): string {
  return `var(--series-${slot})`;
}

export function AvgPositionChart({ trends }: { trends: SubjectTrend[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");

  const withData = trends.filter((t) => t.points.some((p) => p.avgOrganicPosition != null));
  const allDates = Array.from(new Set(withData.flatMap((t) => t.points.map((p) => p.date)))).sort();

  if (allDates.length === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No organic ranking history yet - run tracking at least once.
      </div>
    );
  }

  const maxPosition = Math.max(
    10,
    ...withData.flatMap((t) => t.points.map((p) => p.avgOrganicPosition ?? 0))
  );
  const innerWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xFor = (i: number) => PAD_LEFT + (allDates.length === 1 ? innerWidth / 2 : (i / (allDates.length - 1)) * innerWidth);
  // Lower position is better, so it renders near the top.
  const yFor = (position: number) => PAD_TOP + (position / maxPosition) * innerHeight;

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Average organic position
          </h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Lower is better - only counted on days each brand actually ranked organically.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setView("chart")}
            className="rounded px-2 py-1"
            style={{ color: view === "chart" ? "var(--text-primary)" : "var(--text-muted)", background: view === "chart" ? "var(--gridline)" : "transparent" }}
          >
            Chart
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            className="rounded px-2 py-1"
            style={{ color: view === "table" ? "var(--text-primary)" : "var(--text-muted)", background: view === "table" ? "var(--gridline)" : "transparent" }}
          >
            Table
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        {withData.map((t) => (
          <span key={t.id} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: colorFor(t.colorSlot) }} />
            {t.name}
          </span>
        ))}
      </div>

      {view === "chart" ? (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Average organic position over time">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={PAD_TOP + f * innerHeight} y2={PAD_TOP + f * innerHeight} stroke="var(--gridline)" strokeWidth={1} />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={PAD_LEFT - 6} y={PAD_TOP + f * innerHeight + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              #{Math.round(f * maxPosition)}
            </text>
          ))}

          {withData.map((t) => {
            const byDate = new Map(t.points.map((p) => [p.date, p.avgOrganicPosition]));
            let path = "";
            let drawing = false;
            allDates.forEach((date, i) => {
              const position = byDate.get(date);
              if (position == null) {
                drawing = false;
                return;
              }
              path += `${drawing ? "L" : "M"} ${xFor(i)} ${yFor(position)} `;
              drawing = true;
            });
            const lastIdx = [...allDates].reverse().findIndex((d) => byDate.get(d) != null);
            const lastDateIdx = lastIdx === -1 ? -1 : allDates.length - 1 - lastIdx;
            const lastPosition = lastDateIdx >= 0 ? byDate.get(allDates[lastDateIdx]) : null;
            return (
              <g key={t.id}>
                <path d={path} fill="none" stroke={colorFor(t.colorSlot)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {lastPosition != null ? (
                  <circle cx={xFor(lastDateIdx)} cy={yFor(lastPosition)} r={4} fill={colorFor(t.colorSlot)} stroke="var(--surface-1)" strokeWidth={2} />
                ) : null}
              </g>
            );
          })}

          {allDates.map((date, i) =>
            i === 0 || i === allDates.length - 1 || allDates.length <= 6 ? (
              <text key={date} x={xFor(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                {date.slice(5)}
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
              {withData.map((t) => (
                <th key={t.id} className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allDates.map((date) => (
              <tr key={date} className="border-b" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-1.5" style={{ color: "var(--text-primary)" }}>
                  {date}
                </td>
                {withData.map((t) => {
                  const point = t.points.find((p) => p.date === date);
                  return (
                    <td key={t.id} className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                      {point?.avgOrganicPosition != null ? `#${point.avgOrganicPosition.toFixed(1)}` : "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
