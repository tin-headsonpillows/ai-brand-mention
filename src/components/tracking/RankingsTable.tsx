"use client";

import { Favicon } from "./Favicon";
import type { RankedSubject } from "@/lib/tracking/types";

function colorFor(slot: number): string {
  return `var(--series-${slot})`;
}

export function RankingsTable({ subjects }: { subjects: RankedSubject[] }) {
  if (subjects.length <= 1) {
    return (
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        Add competitors in settings to see how your brand ranks against the market.
      </div>
    );
  }

  const yourRank = subjects.findIndex((s) => s.isYourBrand);
  const maxPct = Math.max(...subjects.map((s) => s.visibilityPct), 0.01);

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Rankings
        </h3>
        {yourRank !== -1 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Your brand ranks{" "}
            <strong style={{ color: "var(--series-1)" }}>
              #{yourRank + 1} of {subjects.length}
            </strong>{" "}
            tracked brands by visibility across your keywords.
          </p>
        ) : null}
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
              Visibility
            </th>
            <th className="py-1 pl-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
              Avg. position
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
          </tr>
        </thead>
        <tbody>
          {subjects.map((s, i) => (
            <tr key={s.id} className="border-b" style={{ borderColor: "var(--gridline)" }}>
              <td className="py-1.5 pr-2 tabular" style={{ color: "var(--text-muted)" }}>
                {i + 1}
              </td>
              <td className="py-1.5" style={{ color: "var(--text-primary)" }}>
                <span className="flex items-center gap-1.5">
                  <Favicon domain={s.website} />
                  <span className={s.isYourBrand ? "font-semibold" : undefined}>{s.name}</span>
                  {s.isYourBrand ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                    >
                      you
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="py-1.5 pl-2" style={{ color: "var(--text-primary)" }}>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 rounded" style={{ background: "var(--page-plane)" }}>
                    <div
                      className="h-1.5 rounded"
                      style={{ width: `${Math.max(2, (s.visibilityPct / maxPct) * 100)}%`, background: colorFor(s.colorSlot) }}
                    />
                  </div>
                  <span className="tabular font-medium">{Math.round(s.visibilityPct * 100)}%</span>
                </div>
              </td>
              <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                {s.avgOrganicPosition != null ? `#${s.avgOrganicPosition.toFixed(1)}` : "-"}
              </td>
              <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                {s.organicMatchedDays}/{s.totalKeywordDays}
              </td>
              <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                {s.aiOverviewMatchedDays}/{s.totalKeywordDays}
              </td>
              <td className="py-1.5 pl-2 tabular" style={{ color: "var(--text-primary)" }}>
                {s.aiModeMatchedDays}/{s.totalKeywordDays}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
