"use client";

import { useState } from "react";
import type { Leaderboard } from "@/lib/types";
import { matchesBrand } from "@/lib/mentions";
import { Segmented } from "@/components/tracking/ui";
import { LEVEL_OPTIONS, pct, type EntityLevel } from "./RegionLeaders";

interface BusinessLeaderboardProps {
  leaderboard: Leaderboard;
  /** Brand mode: the brand name plus aliases, highlighted in the table. Empty in market mode. */
  brandTerms: string[];
  /** Heading scope, e.g. "all 3 locations". */
  scope?: string;
}

const VISIBLE_ROWS = 15;

export function BusinessLeaderboard({ leaderboard, brandTerms, scope }: BusinessLeaderboardProps) {
  const [level, setLevel] = useState<EntityLevel>("business");
  const [expanded, setExpanded] = useState(false);
  const list = level === "brand" ? leaderboard.brands : leaderboard.entries;
  const total = leaderboard.totalPromptsAnalyzed;
  const brand = brandTerms[0] ?? "";

  if (leaderboard.entries.length === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No businesses could be extracted from the responses.
      </div>
    );
  }

  const maxCount = list[0]?.mentionCount ?? 1;
  const visible = expanded ? list : list.slice(0, VISIBLE_ROWS);
  const hiddenCount = list.length - visible.length;
  const brandRank = brand ? list.findIndex((e) => matchesBrand(e.name, brandTerms)) + 1 : 0;
  const noun = level === "brand" ? "brands" : "businesses";

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {scope ? `Leaderboard - ${scope}` : "Business leaderboard"}
          </h3>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {brand ? (
              brandRank > 0 ? (
                <>
                  <strong style={{ color: "var(--text-primary)" }}>{brand}</strong> ranks{" "}
                  <strong style={{ color: "var(--series-1)" }}>
                    #{brandRank} of {list.length}
                  </strong>{" "}
                  {noun} ChatGPT mentioned across {total} answers.
                </>
              ) : (
                <>
                  <strong style={{ color: "var(--text-primary)" }}>{brand}</strong> did not appear among the {list.length}{" "}
                  {noun} ChatGPT mentioned across {total} answers.
                </>
              )
            ) : (
              <>
                <strong style={{ color: "var(--text-primary)" }}>{list[0].name}</strong> is the most recommended - in{" "}
                {pct(list[0].mentionCount, total)} of {total} answers, out of {list.length} {noun} mentioned.
              </>
            )}
          </p>
        </div>
        <Segmented value={level} options={LEVEL_OPTIONS} onChange={setLevel} ariaLabel="Group by" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--gridline)" }}>
              <th className="py-1 pr-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                #
              </th>
              <th className="py-1 pr-2 font-medium" style={{ color: "var(--text-secondary)" }}>
                {level === "brand" ? "Brand" : "Business"}
              </th>
              <th className="py-1 pr-2 font-medium" style={{ color: "var(--text-secondary)" }}>
                Answers mentioning
              </th>
              <th
                className="py-1 pr-2 text-right font-medium tabular"
                style={{ color: "var(--text-secondary)" }}
                title="Answers that listed it first"
              >
                Listed first
              </th>
              <th
                className="py-1 text-right font-medium tabular"
                style={{ color: "var(--text-secondary)" }}
                title="Average place in the answer's list of recommendations (1 = first)"
              >
                Avg. position
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry, i) => {
              const mine = brandTerms.length > 0 && matchesBrand(entry.name, brandTerms);
              const showBrand = level === "business" && entry.brand && entry.brand.toLowerCase() !== entry.name.toLowerCase();
              return (
                <tr key={entry.name} className="border-b" style={{ borderColor: "var(--gridline)" }}>
                  <td className="py-1.5 pr-2 tabular align-top" style={{ color: "var(--text-muted)" }}>
                    {i + 1}
                  </td>
                  <td className="py-1.5 pr-2" style={{ color: "var(--text-primary)" }}>
                    <span className="flex flex-wrap items-center gap-x-1.5">
                      <span className={mine ? "font-semibold" : undefined}>{entry.name}</span>
                      {mine ? (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                        >
                          your brand
                        </span>
                      ) : null}
                      {showBrand ? (
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {entry.brand}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 shrink-0 rounded" style={{ background: "var(--page-plane)" }}>
                        <div
                          className="h-2 rounded"
                          style={{
                            width: `${Math.max(4, (entry.mentionCount / maxCount) * 100)}%`,
                            background: mine ? "var(--series-1)" : "var(--de-emphasis)",
                          }}
                        />
                      </div>
                      <span className="tabular whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                        {pct(entry.mentionCount, total)}{" "}
                        <span style={{ color: "var(--text-muted)" }}>({entry.mentionCount})</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {entry.firstCount}
                  </td>
                  <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {entry.avgPosition !== null ? entry.avgPosition.toFixed(1) : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>
          Extracted by re-reading every answer with the model - names are AI-identified and may need a manual sanity
          check.
        </span>
        {hiddenCount > 0 || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-medium"
            style={{ color: "var(--series-1)" }}
          >
            {expanded ? "Show top 15" : `Show all ${list.length}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
