"use client";

import type { AspectRow, Bucket } from "@/lib/reviews/stats";

export interface HeatmapSelection {
  aspect: string;
  sentiment?: "positive" | "negative";
  bucket?: number;
}

/**
 * Sequential intensity within one hue: more mentions mix in more of the sentiment color. A square-root
 * scale keeps a cell with a handful of mentions visible next to one with dozens.
 */
function shade(count: number, max: number, color: string): React.CSSProperties {
  if (count <= 0 || max <= 0) return { background: "var(--page-plane)", color: "var(--text-muted)" };
  const strength = Math.round(14 + 76 * Math.sqrt(count / max));
  return {
    background: `color-mix(in srgb, ${color} ${strength}%, var(--surface-1))`,
    color: strength >= 52 ? "#fff" : "var(--text-primary)",
  };
}

const POS = "var(--sentiment-positive)";
const NEG = "var(--sentiment-negative)";

function Half({
  count,
  max,
  sentiment,
  title,
  selected,
  onClick,
}: {
  count: number;
  max: number;
  sentiment: "positive" | "negative";
  title: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-[18px] w-full items-center justify-center text-[10px] font-semibold tabular"
      style={{
        ...shade(count, max, sentiment === "positive" ? POS : NEG),
        outline: selected ? "2px solid var(--text-primary)" : undefined,
        outlineOffset: -2,
      }}
    >
      {count > 0 ? count : ""}
    </button>
  );
}

export function SentimentHeatmap({
  rows,
  buckets,
  selection,
  onSelect,
}: {
  rows: AspectRow[];
  buckets: Bucket[];
  selection: HeatmapSelection | null;
  onSelect: (selection: HeatmapSelection) => void;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.flatMap((c) => [c.positive, c.negative])));
  const maxTotal = Math.max(1, ...rows.map((r) => Math.max(r.positive, r.negative)));
  const isSelected = (aspect: string, bucket?: number, sentiment?: "positive" | "negative") =>
    selection?.aspect === aspect && selection.bucket === bucket && selection.sentiment === sentiment;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full border-separate text-sm" style={{ borderSpacing: "2px" }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[170px] px-2 py-1 text-left text-xs font-medium" style={{ color: "var(--text-secondary)", background: "var(--surface-1)" }}>
                Aspect
              </th>
              <th className="w-20 px-1 py-1 text-center text-xs font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }} title="Points of praise in the period">
                + Praise
              </th>
              <th className="w-20 px-1 py-1 text-center text-xs font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }} title="Points of criticism in the period">
                − Criticism
              </th>
              <th className="w-24 px-1 py-1 text-left text-xs font-medium" style={{ color: "var(--text-secondary)" }} title="Share of this aspect's mentions that are positive">
                Positive
              </th>
              {buckets.map((b, i) => (
                <th
                  key={i}
                  className="min-w-[38px] px-0.5 py-1 text-center text-[10px] font-medium whitespace-nowrap"
                  style={{ color: "var(--text-muted)" }}
                  title={b.title}
                >
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const total = row.positive + row.negative;
              const share = total ? row.positive / total : 0;
              return (
                <tr key={row.aspect}>
                  <td className="sticky left-0 z-10 px-2 py-0.5" style={{ background: "var(--surface-1)" }}>
                    <button
                      type="button"
                      onClick={() => onSelect({ aspect: row.aspect })}
                      className="text-left text-sm font-medium hover:underline"
                      style={{ color: "var(--text-primary)", textDecorationThickness: isSelected(row.aspect) ? 2 : undefined }}
                      title={`${row.aspect}: mentioned in ${row.reviews} reviews - show them`}
                    >
                      {row.aspect}
                    </button>
                  </td>
                  <td className="p-0">
                    <button
                      type="button"
                      onClick={() => onSelect({ aspect: row.aspect, sentiment: "positive" })}
                      className="flex h-[38px] w-full items-center justify-center rounded text-sm font-semibold tabular"
                      style={{
                        ...shade(row.positive, maxTotal, POS),
                        outline: isSelected(row.aspect, undefined, "positive") ? "2px solid var(--text-primary)" : undefined,
                        outlineOffset: -2,
                      }}
                      title={`${row.positive} points of praise about ${row.aspect}`}
                    >
                      {row.positive}
                    </button>
                  </td>
                  <td className="p-0">
                    <button
                      type="button"
                      onClick={() => onSelect({ aspect: row.aspect, sentiment: "negative" })}
                      className="flex h-[38px] w-full items-center justify-center rounded text-sm font-semibold tabular"
                      style={{
                        ...shade(row.negative, maxTotal, NEG),
                        outline: isSelected(row.aspect, undefined, "negative") ? "2px solid var(--text-primary)" : undefined,
                        outlineOffset: -2,
                      }}
                      title={`${row.negative} points of criticism about ${row.aspect}`}
                    >
                      {row.negative}
                    </button>
                  </td>
                  <td className="px-1">
                    <div className="flex items-center gap-1.5" title={`${Math.round(share * 100)}% of mentions are positive`}>
                      <div className="flex h-2 w-12 overflow-hidden rounded-full" style={{ background: "var(--page-plane)" }}>
                        <div style={{ width: `${share * 100}%`, background: POS }} />
                        <div style={{ width: `${(1 - share) * 100}%`, background: NEG, marginLeft: share > 0 && share < 1 ? 1 : 0 }} />
                      </div>
                      <span className="text-xs tabular" style={{ color: "var(--text-secondary)" }}>
                        {Math.round(share * 100)}%
                      </span>
                    </div>
                  </td>
                  {row.cells.map((cell, i) => (
                    <td key={i} className="p-0 align-middle">
                      <div className="flex flex-col gap-px overflow-hidden rounded">
                        <Half
                          count={cell.positive}
                          max={max}
                          sentiment="positive"
                          title={`${row.aspect} · ${buckets[i].title}: ${cell.positive} praise`}
                          selected={isSelected(row.aspect, i, "positive")}
                          onClick={() => onSelect({ aspect: row.aspect, sentiment: "positive", bucket: i })}
                        />
                        <Half
                          count={cell.negative}
                          max={max}
                          sentiment="negative"
                          title={`${row.aspect} · ${buckets[i].title}: ${cell.negative} criticism`}
                          selected={isSelected(row.aspect, i, "negative")}
                          onClick={() => onSelect({ aspect: row.aspect, sentiment: "negative", bucket: i })}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span className="flex items-center gap-2">
          <span className="font-medium">+ Praise</span>
          <span aria-hidden className="h-2.5 w-24 rounded" style={{ background: `linear-gradient(to right, color-mix(in srgb, ${POS} 14%, var(--surface-1)), ${POS})` }} />
        </span>
        <span className="flex items-center gap-2">
          <span className="font-medium">− Criticism</span>
          <span aria-hidden className="h-2.5 w-24 rounded" style={{ background: `linear-gradient(to right, color-mix(in srgb, ${NEG} 14%, var(--surface-1)), ${NEG})` }} />
        </span>
        <span style={{ color: "var(--text-muted)" }}>
          Darker = more customer mentions. Each period cell: praise on top, criticism below. Click any cell to read those reviews.
        </span>
      </div>
    </div>
  );
}
