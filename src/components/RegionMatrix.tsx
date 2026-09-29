"use client";

import { useState } from "react";
import type { Leaderboard, RegionReport } from "@/lib/types";
import { matchesBrand } from "@/lib/mentions";
import { Segmented } from "@/components/tracking/ui";
import { LEVEL_OPTIONS, type EntityLevel } from "./RegionLeaders";

const MAX_ROWS = 12;

/** Sequential single-hue shade: the share of answers maps to how much of the series-1 hue is mixed in. */
function cellStyle(share: number): React.CSSProperties {
  if (share <= 0) return { background: "transparent", color: "var(--text-muted)" };
  const strength = Math.round(10 + share * 80);
  return {
    background: `color-mix(in srgb, var(--series-1) ${strength}%, var(--surface-1))`,
    color: strength >= 55 ? "#fff" : "var(--text-primary)",
  };
}

function shares(board: Leaderboard, level: EntityLevel): Map<string, { share: number; count: number }> {
  const list = level === "brand" ? board.brands : board.entries;
  const total = board.totalPromptsAnalyzed;
  return new Map(list.map((e) => [e.name.toLowerCase(), { share: total ? e.mentionCount / total : 0, count: e.mentionCount }]));
}

/**
 * Rows = the most-recommended names across all locations, columns = locations. Answers the "who wins
 * where" question: a chain strong everywhere reads as a solid row, a local favourite as a single hot cell.
 */
export function RegionMatrix({
  regions,
  overall,
  brandTerms,
}: {
  regions: RegionReport[];
  overall: Leaderboard;
  brandTerms: string[];
}) {
  const [level, setLevel] = useState<EntityLevel>("brand");
  const rows = (level === "brand" ? overall.brands : overall.entries).slice(0, MAX_ROWS);
  const columns = regions.map((r) => ({ region: r, lookup: shares(r.leaderboard, level) }));
  const overallLookup = shares(overall, level);
  // Leader of each column among the visible rows, emphasised in bold.
  const leaders = columns.map(({ lookup }) => {
    let best = "";
    let bestShare = 0;
    for (const row of rows) {
      const share = lookup.get(row.name.toLowerCase())?.share ?? 0;
      if (share > bestShare) {
        best = row.name;
        bestShare = share;
      }
    }
    return best;
  });

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Who wins where
          </h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Share of each location&apos;s answers that mention the {level === "brand" ? "brand" : "business"}; the
            leader in each location is in bold.
          </p>
        </div>
        <Segmented value={level} options={LEVEL_OPTIONS} onChange={setLevel} ariaLabel="Group by" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate text-sm" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                {level === "brand" ? "Brand" : "Business"}
              </th>
              {columns.map(({ region }) => (
                <th
                  key={region.location}
                  className="px-2 py-1 text-center text-xs font-medium whitespace-nowrap"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {region.location}
                </th>
              ))}
              <th className="px-2 py-1 text-center text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                All
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const mine = brandTerms.length > 0 && matchesBrand(row.name, brandTerms);
              const all = overallLookup.get(row.name.toLowerCase());
              return (
                <tr key={row.name}>
                  <td
                    className={`max-w-[260px] truncate px-2 py-1.5 ${mine ? "font-semibold" : ""}`}
                    style={{ color: "var(--text-primary)" }}
                    title={row.name}
                  >
                    {row.name}
                    {mine ? (
                      <span className="ml-1.5 text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>
                        your brand
                      </span>
                    ) : null}
                  </td>
                  {columns.map(({ region, lookup }, i) => {
                    const cell = lookup.get(row.name.toLowerCase());
                    const share = cell?.share ?? 0;
                    return (
                      <td
                        key={region.location}
                        className={`rounded px-2 py-1.5 text-center tabular ${leaders[i] === row.name ? "font-bold" : ""}`}
                        style={cellStyle(share)}
                        title={`${row.name} in ${region.location}: ${cell?.count ?? 0} of ${region.leaderboard.totalPromptsAnalyzed} answers`}
                      >
                        {share > 0 ? `${Math.round(share * 100)}%` : "–"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center tabular" style={{ color: "var(--text-secondary)" }}>
                    {all ? `${Math.round(all.share * 100)}%` : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>0%</span>
        <span
          aria-hidden
          className="h-2 w-32 rounded"
          style={{
            background:
              "linear-gradient(to right, color-mix(in srgb, var(--series-1) 10%, var(--surface-1)), color-mix(in srgb, var(--series-1) 90%, var(--surface-1)))",
          }}
        />
        <span>100% of the location&apos;s answers</span>
      </div>
    </section>
  );
}
