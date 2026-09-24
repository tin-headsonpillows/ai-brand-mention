"use client";

import type { BrandMentionEntry } from "@/lib/tracking/types";

const VISIBLE_ROWS = 15;

export function BrandMentionLeaderboard({ entries }: { entries: BrandMentionEntry[] }) {
  if (entries.length === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No brand mentions detected yet - run tracking at least once.
      </div>
    );
  }

  const yourRank = entries.findIndex((e) => e.isYourBrand);
  const maxCount = entries[0]?.mentionCount || 1;
  const visible = entries.slice(0, VISIBLE_ROWS);
  const hiddenCount = entries.length - visible.length;

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Brand mentions across the market
        </h3>
        {yourRank !== -1 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Your brand ranks{" "}
            <strong style={{ color: "var(--series-1)" }}>
              #{yourRank + 1} of {entries.length}
            </strong>{" "}
            brands appearing across tracked keywords.
          </p>
        ) : null}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Other brands are pattern-matched from search snippets and AI answers (no extra API calls), so treat their
          counts as directional - your own brand&apos;s count is exact.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left" style={{ borderColor: "var(--gridline)" }}>
            <th className="py-1 pr-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              #
            </th>
            <th className="py-1 font-medium" style={{ color: "var(--text-secondary)" }}>
              Brand
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              Organic
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              AI Overview
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              AI Mode
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((entry, i) => (
            <tr key={entry.name} className="border-b" style={{ borderColor: "var(--gridline)" }}>
              <td className="py-1.5 pr-2 tabular" style={{ color: "var(--text-muted)" }}>
                {i + 1}
              </td>
              <td className="py-1.5" style={{ color: "var(--text-primary)" }}>
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: entry.isYourBrand ? "var(--series-1)" : "var(--de-emphasis)" }}
                  />
                  <span className={entry.isYourBrand ? "font-semibold" : undefined}>{entry.name}</span>
                  {entry.isYourBrand ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                    >
                      your brand
                    </span>
                  ) : null}
                </span>
                <div className="mt-1 h-1.5 w-full max-w-[160px] rounded" style={{ background: "var(--page-plane)" }}>
                  <div
                    className="h-1.5 rounded"
                    style={{
                      width: `${Math.max(4, (entry.mentionCount / maxCount) * 100)}%`,
                      background: entry.isYourBrand ? "var(--series-1)" : "var(--de-emphasis)",
                    }}
                  />
                </div>
              </td>
              <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                {entry.organicMentions || "-"}
              </td>
              <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                {entry.aiOverviewMentions || "-"}
              </td>
              <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                {entry.aiModeMentions || "-"}
              </td>
              <td className="py-1.5 pl-2 tabular font-medium" style={{ color: "var(--text-primary)" }}>
                {entry.mentionCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hiddenCount > 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          +{hiddenCount} more brands mentioned less often.
        </p>
      ) : null}
    </div>
  );
}
