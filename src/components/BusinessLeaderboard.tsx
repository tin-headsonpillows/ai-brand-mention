"use client";

import type { Leaderboard } from "@/lib/types";

interface BusinessLeaderboardProps {
  leaderboard: Leaderboard;
  yourBrandRank: number | null;
  brand: string;
}

const VISIBLE_ROWS = 15;

function isBrandRow(name: string, brand: string): boolean {
  const a = name.toLowerCase();
  const b = brand.toLowerCase();
  return a.includes(b) || b.includes(a);
}

export function BusinessLeaderboard({ leaderboard, yourBrandRank, brand }: BusinessLeaderboardProps) {
  const { entries, totalPromptsAnalyzed } = leaderboard;

  if (entries.length === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No businesses could be extracted from the responses.
      </div>
    );
  }

  const maxCount = entries[0]?.mentionCount ?? 1;
  const visible = entries.slice(0, VISIBLE_ROWS);
  const hiddenCount = entries.length - visible.length;

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Business leaderboard
        </h3>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {yourBrandRank ? (
            <>
              <strong style={{ color: "var(--text-primary)" }}>{brand}</strong> ranks{" "}
              <strong style={{ color: "var(--series-1)" }}>
                #{yourBrandRank} of {entries.length}
              </strong>{" "}
              businesses ChatGPT mentioned across {totalPromptsAnalyzed} prompts.
            </>
          ) : (
            <>
              <strong style={{ color: "var(--text-primary)" }}>{brand}</strong> did not appear among the{" "}
              {entries.length} businesses ChatGPT mentioned across {totalPromptsAnalyzed} prompts.
            </>
          )}
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Extracted by re-reading every response with the model - names are AI-identified and may need a manual
          sanity check.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left" style={{ borderColor: "var(--gridline)" }}>
            <th className="py-1 pr-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              #
            </th>
            <th className="py-1 font-medium" style={{ color: "var(--text-secondary)" }}>
              Business
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              Mentions
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((entry, i) => {
            const mine = isBrandRow(entry.name, brand);
            return (
              <tr key={entry.name} className="border-b" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-1.5 pr-2 tabular" style={{ color: "var(--text-muted)" }}>
                  {i + 1}
                </td>
                <td className="py-1.5" style={{ color: "var(--text-primary)" }}>
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: mine ? "var(--series-1)" : "var(--de-emphasis)" }}
                    />
                    <span className={mine ? "font-semibold" : undefined}>{entry.name}</span>
                    {mine ? (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                      >
                        your brand
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="py-1.5 pl-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 rounded" style={{ background: "var(--page-plane)" }}>
                      <div
                        className="h-2 rounded"
                        style={{
                          width: `${Math.max(4, (entry.mentionCount / maxCount) * 100)}%`,
                          background: mine ? "var(--series-1)" : "var(--de-emphasis)",
                        }}
                      />
                    </div>
                    <span className="tabular" style={{ color: "var(--text-primary)" }}>
                      {entry.mentionCount}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {hiddenCount > 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          +{hiddenCount} more mentioned less often.
        </p>
      ) : null}
    </div>
  );
}
