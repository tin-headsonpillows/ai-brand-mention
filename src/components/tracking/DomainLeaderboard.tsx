"use client";

import { Favicon } from "./Favicon";
import type { DomainLeaderboardEntry } from "@/lib/tracking/types";

const VISIBLE_ROWS = 15;

export function DomainLeaderboard({
  entries,
  onExclude,
}: {
  entries: DomainLeaderboardEntry[];
  onExclude: (domain: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No cited websites yet - run tracking at least once.
      </div>
    );
  }

  const maxExposure = Math.max(
    ...entries.map((e) => e.organicAppearances + e.aiOverviewCitations + e.aiModeCitations)
  );
  const visible = entries.slice(0, VISIBLE_ROWS);
  const hiddenCount = entries.length - visible.length;

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Cited websites
        </h3>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Every domain seen in organic results or cited as an AI Overview / AI Mode source, ranked by total exposure.
          Hide a blog or OTA you don&apos;t want counted.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left" style={{ borderColor: "var(--gridline)" }}>
            <th className="py-1 pr-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              #
            </th>
            <th className="py-1 font-medium" style={{ color: "var(--text-secondary)" }}>
              Domain
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              Organic (avg pos)
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              AI Overview
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              AI Mode
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              Keywords
            </th>
            <th className="py-1 pl-2" />
          </tr>
        </thead>
        <tbody>
          {visible.map((entry, i) => {
            const exposure = entry.organicAppearances + entry.aiOverviewCitations + entry.aiModeCitations;
            return (
              <tr key={entry.domain} className="border-b" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-1.5 pr-2 tabular" style={{ color: "var(--text-muted)" }}>
                  {i + 1}
                </td>
                <td className="py-1.5" style={{ color: "var(--text-primary)" }}>
                  <span className="flex items-center gap-1.5">
                    <Favicon domain={entry.domain} />
                    <span className={entry.isYourBrand ? "font-semibold" : undefined}>{entry.domain}</span>
                    {entry.isYourBrand ? (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                      >
                        your brand
                      </span>
                    ) : entry.isCompetitor ? (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: "var(--meter-track)", color: "var(--series-1)" }}
                      >
                        {entry.competitorName}
                      </span>
                    ) : null}
                  </span>
                  <div className="mt-1 h-1.5 w-full max-w-[160px] rounded" style={{ background: "var(--page-plane)" }}>
                    <div
                      className="h-1.5 rounded"
                      style={{
                        width: `${Math.max(4, (exposure / maxExposure) * 100)}%`,
                        background: entry.isYourBrand ? "var(--series-1)" : "var(--de-emphasis)",
                      }}
                    />
                  </div>
                </td>
                <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                  {entry.organicAppearances > 0
                    ? `${entry.organicAppearances} (#${entry.avgOrganicPosition?.toFixed(1)})`
                    : "-"}
                </td>
                <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                  {entry.aiOverviewCitations || "-"}
                </td>
                <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                  {entry.aiModeCitations || "-"}
                </td>
                <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                  {entry.keywordsCitedIn}
                </td>
                <td className="py-1.5 pl-2 text-right">
                  {entry.isYourBrand ? null : (
                    <button
                      type="button"
                      onClick={() => onExclude(entry.domain)}
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                      title="Hide this domain from the leaderboard"
                    >
                      Hide
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {hiddenCount > 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          +{hiddenCount} more domains cited less often.
        </p>
      ) : null}
    </div>
  );
}
