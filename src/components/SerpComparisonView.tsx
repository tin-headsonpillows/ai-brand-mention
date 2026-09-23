"use client";

import type { ComparisonRow, MatchCategory, SerpComparison } from "@/lib/types";

interface SerpComparisonViewProps {
  comparison: SerpComparison;
}

const CATEGORY_LABEL: Record<MatchCategory, string> = {
  both: "Balanced (AI + local pack)",
  ai_only: "AI mentions only",
  serp_only: "Local pack only",
};

const CATEGORY_COLOR: Record<MatchCategory, string> = {
  both: "var(--status-good)",
  ai_only: "var(--series-1)",
  serp_only: "var(--status-warning)",
};

function CategoryBadge({ category }: { category: MatchCategory }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium"
      style={{ color: "var(--text-secondary)" }}
    >
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[category] }} />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

function Row({ row }: { row: ComparisonRow }) {
  return (
    <tr className="border-b" style={{ borderColor: "var(--gridline)" }}>
      <td className="py-1.5 pr-2" style={{ color: "var(--text-primary)" }}>
        {row.name}
      </td>
      <td className="py-1.5 pr-2">
        <CategoryBadge category={row.category} />
      </td>
      <td className="py-1.5 pr-2 tabular" style={{ color: "var(--text-primary)" }}>
        {row.aiMentionCount ?? "-"}
      </td>
      <td className="py-1.5 pr-2 tabular" style={{ color: "var(--text-primary)" }}>
        {row.serpRating ?? "-"}
      </td>
      <td className="py-1.5 pr-2 tabular" style={{ color: "var(--text-primary)" }}>
        {row.serpReviews ?? "-"}
      </td>
      <td className="py-1.5 tabular" style={{ color: "var(--text-primary)" }}>
        {row.serpPosition ?? "-"}
      </td>
    </tr>
  );
}

export function SerpComparisonView({ comparison }: SerpComparisonViewProps) {
  const { rows, location, query, mock } = comparison;

  const counts = {
    both: rows.filter((r) => r.category === "both").length,
    aiOnly: rows.filter((r) => r.category === "ai_only").length,
    serpOnly: rows.filter((r) => r.category === "serp_only").length,
  };

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          ChatGPT vs. Google local results
        </h3>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Comparing businesses ChatGPT mentioned against Google&apos;s local pack for &quot;{query}&quot; near{" "}
          {location}.
        </p>
        {mock ? (
          <p className="text-xs" style={{ color: "var(--status-warning)" }}>
            Using simulated local results - add SERPAPI_API_KEY to compare against real Google Local &amp; Maps
            data.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span>{counts.both} balanced</span>
        <span>{counts.aiOnly} AI-only</span>
        <span>{counts.serpOnly} local-pack-only</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No businesses found in either source to compare.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--gridline)" }}>
              <th className="py-1 pr-2 font-medium" style={{ color: "var(--text-secondary)" }}>
                Business
              </th>
              <th className="py-1 pr-2 font-medium" style={{ color: "var(--text-secondary)" }}>
                Gap signal
              </th>
              <th className="py-1 pr-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                AI mentions
              </th>
              <th className="py-1 pr-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                Rating
              </th>
              <th className="py-1 pr-2 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                Reviews
              </th>
              <th className="py-1 font-medium tabular" style={{ color: "var(--text-secondary)" }}>
                Local pack #
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.name} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
