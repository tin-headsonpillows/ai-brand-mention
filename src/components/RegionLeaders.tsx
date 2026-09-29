"use client";

import { useState } from "react";
import type { LeaderboardEntry, RegionReport } from "@/lib/types";
import { matchesBrand } from "@/lib/mentions";
import { Segmented } from "@/components/tracking/ui";

export type EntityLevel = "business" | "brand";

export const LEVEL_OPTIONS: Array<{ value: EntityLevel; label: string; title: string }> = [
  { value: "business", label: "Businesses", title: "Each property separately" },
  { value: "brand", label: "Brands", title: "Properties rolled up to their chain / parent brand" },
];

const TOP_N = 6;

export function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : "0%";
}

function Row({
  rank,
  entry,
  total,
  max,
  mine,
}: {
  rank: number;
  entry: LeaderboardEntry;
  total: number;
  max: number;
  mine: boolean;
}) {
  return (
    <li
      className="grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_2.75rem] items-center gap-2 py-1 text-sm"
      title={`${entry.name}: mentioned in ${entry.mentionCount} of ${total} answers, listed first in ${entry.firstCount}`}
    >
      <span className="tabular text-xs" style={{ color: "var(--text-muted)" }}>
        {rank}
      </span>
      <span className={`truncate ${mine ? "font-semibold" : ""}`} style={{ color: "var(--text-primary)" }}>
        {entry.name}
      </span>
      <span className="h-2 rounded" style={{ background: "var(--page-plane)" }}>
        <span
          className="block h-2 rounded"
          style={{
            width: `${Math.max(4, (entry.mentionCount / max) * 100)}%`,
            background: mine ? "var(--series-1)" : "var(--de-emphasis)",
          }}
        />
      </span>
      <span className="tabular text-right text-xs" style={{ color: "var(--text-secondary)" }}>
        {pct(entry.mentionCount, total)}
      </span>
    </li>
  );
}

function RegionCard({
  region,
  level,
  brandTerms,
  brandMode,
}: {
  region: RegionReport;
  level: EntityLevel;
  brandTerms: string[];
  brandMode: boolean;
}) {
  const board = region.leaderboard;
  const list = level === "brand" ? board.brands : board.entries;
  const total = board.totalPromptsAnalyzed;
  const leader = list[0];
  const max = leader?.mentionCount ?? 1;
  const top = list.slice(0, TOP_N);
  const brandIndex = brandTerms.length ? list.findIndex((e) => matchesBrand(e.name, brandTerms)) : -1;

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {region.location}
        </h4>
        <span className="text-xs tabular" style={{ color: "var(--text-muted)" }}>
          {total} answers · {list.length} {level === "brand" ? "brands" : "businesses"}
        </span>
      </header>

      {leader ? (
        <div className="flex flex-col gap-0.5 rounded-md p-3" style={{ background: "var(--page-plane)" }}>
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Most recommended
          </span>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {leader.name}
          </span>
          <span className="text-xs tabular" style={{ color: "var(--text-secondary)" }}>
            In {pct(leader.mentionCount, total)} of answers · listed first in {pct(leader.firstCount, total)}
          </span>
        </div>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No businesses found in these answers.
        </p>
      )}

      {top.length > 1 ? (
        <ol className="flex flex-col">
          {top.map((entry, i) => (
            <Row
              key={entry.name}
              rank={i + 1}
              entry={entry}
              total={total}
              max={max}
              mine={brandTerms.length > 0 && matchesBrand(entry.name, brandTerms)}
            />
          ))}
        </ol>
      ) : null}

      {brandMode ? (
        <p className="border-t pt-2 text-xs" style={{ borderColor: "var(--gridline)", color: "var(--text-secondary)" }}>
          Your brand:{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {brandIndex === -1 ? "not in the list" : `#${brandIndex + 1}`}
          </strong>{" "}
          · mentioned in {Math.round(region.brandMentionRate * 100)}% of answers
        </p>
      ) : null}
    </article>
  );
}

export function RegionLeaders({
  regions,
  brandTerms,
  brandMode,
}: {
  regions: RegionReport[];
  brandTerms: string[];
  brandMode: boolean;
}) {
  const [level, setLevel] = useState<EntityLevel>("business");

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Top recommendations by location
          </h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Share of each location&apos;s answers that mention the business. Hover a row for how often it was listed
            first.
          </p>
        </div>
        <Segmented value={level} options={LEVEL_OPTIONS} onChange={setLevel} ariaLabel="Group by" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {regions.map((region) => (
          <RegionCard key={region.location} region={region} level={level} brandTerms={brandTerms} brandMode={brandMode} />
        ))}
      </div>
    </section>
  );
}
