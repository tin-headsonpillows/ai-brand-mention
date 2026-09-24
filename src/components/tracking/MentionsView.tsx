"use client";

import { useState } from "react";
import { periodMetrics, seriesColor, type DomainRow, type SubjectSeries } from "@/lib/tracking/analytics";
import { formatCount, formatPosition, trendTitle } from "@/lib/tracking/format";
import { Favicon } from "./Favicon";
import { TrendChart } from "./TrendChart";
import { ChartTableToggle, Delta, Headline, IconGlobe, IconLink, IconMessage, Panel, Switch, type ChartView } from "./ui";

interface MentionsViewProps {
  dates: string[];
  series: SubjectSeries[];
  domainRows: DomainRow[];
  hiddenCount: number;
  compare: boolean;
  onCompareChange: (v: boolean) => void;
  onExclude: (domain: string) => void;
  periodLabel: string;
  surfaceLabel: string;
}

const VISIBLE_ROWS = 20;

export function MentionsView({
  dates,
  series,
  domainRows,
  hiddenCount,
  compare,
  onCompareChange,
  onExclude,
  periodLabel,
  surfaceLabel,
}: MentionsViewProps) {
  const [mentionsView, setMentionsView] = useState<ChartView>("chart");
  const [citationsView, setCitationsView] = useState<ChartView>("chart");
  const [showAll, setShowAll] = useState(false);

  const shown = compare ? series : series.filter((s) => s.subject.isYourBrand);
  const metrics = periodMetrics(series, Math.max(0, series.findIndex((s) => s.subject.isYourBrand)));
  const { mentions, citations } = metrics;
  const trend = trendTitle(metrics.halfDays);
  const canCompare = series.length > 1;
  const compareSwitch = canCompare ? <Switch checked={compare} onChange={onCompareChange} label="Compare competitors" /> : null;

  const chartSeries = (pick: "mentions" | "citations") =>
    shown.map((s) => ({
      id: s.subject.id,
      label: s.subject.name,
      color: seriesColor(s.subject.colorSlot),
      values: s.days.map((d) => d[pick]),
      directLabel: s.subject.isYourBrand,
    }));

  const maxTotal = domainRows[0]?.total ?? 1;
  const visible = showAll ? domainRows : domainRows.slice(0, VISIBLE_ROWS);
  const count = (v: number) => formatCount(Math.round(v));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          icon={<IconMessage />}
          title="Mentions"
          subtitle={`Times your brand appears across ${surfaceLabel.toLowerCase()}`}
          actions={<ChartTableToggle view={mentionsView} onChange={setMentionsView} />}
          footer={
            <>
              <span>{periodLabel}</span>
              {compareSwitch}
            </>
          }
        >
          <Headline
            label="Total mentions"
            value={mentions.value != null ? count(mentions.value) : "–"}
            delta={<Delta value={mentions.delta} format={count} title={trend} />}
          />
          <TrendChart
            dates={dates}
            series={chartSeries("mentions")}
            format={count}
            view={mentionsView}
            ariaLabel="Brand mentions per day"
          />
        </Panel>

        <Panel
          icon={<IconLink />}
          title="Citations"
          subtitle="Times your website is linked in results or AI sources"
          actions={<ChartTableToggle view={citationsView} onChange={setCitationsView} />}
          footer={
            <>
              <span>{periodLabel}</span>
              {compareSwitch}
            </>
          }
        >
          <Headline
            label="Total citations"
            value={citations.value != null ? count(citations.value) : "–"}
            delta={<Delta value={citations.delta} format={count} title={trend} />}
          />
          <TrendChart
            dates={dates}
            series={chartSeries("citations")}
            format={count}
            view={citationsView}
            ariaLabel="Website citations per day"
          />
        </Panel>
      </div>

      <Panel
        icon={<IconGlobe />}
        title="Cited websites"
        subtitle="Every domain in organic results or cited by AI answers"
        bodyClassName="overflow-x-auto"
        footer={
          <>
            <span>
              {domainRows.length} domains · {periodLabel}
              {hiddenCount > 0 ? ` · ${hiddenCount} hidden (manage in Settings)` : ""}
            </span>
            {domainRows.length > VISIBLE_ROWS ? (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="font-medium" style={{ color: "var(--series-1)" }}>
                {showAll ? "Show top 20" : `Show all ${domainRows.length}`}
              </button>
            ) : null}
          </>
        }
      >
        {domainRows.length === 0 ? (
          <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>
            No cited websites in this period yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs" style={{ borderColor: "var(--gridline)", color: "var(--text-secondary)" }}>
                <th className="w-10 px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 text-right font-medium">Organic</th>
                <th className="px-3 py-2 text-right font-medium">Avg. pos</th>
                <th className="px-3 py-2 text-right font-medium">AI Overview</th>
                <th className="px-3 py-2 text-right font-medium">AI Mode</th>
                <th className="px-3 py-2 text-right font-medium">Keywords</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => (
                <tr
                  key={row.domain}
                  className="group border-b last:border-b-0"
                  style={{
                    borderColor: "var(--gridline)",
                    background: row.owner?.isYourBrand ? "color-mix(in srgb, var(--series-1) 6%, transparent)" : undefined,
                  }}
                >
                  <td className="px-3 py-2 tabular" style={{ color: "var(--text-muted)" }}>
                    {i + 1}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Favicon domain={row.domain} size={16} />
                      <a
                        href={row.sampleLink ?? `https://${row.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`truncate hover:underline ${row.owner?.isYourBrand ? "font-semibold" : ""}`}
                        style={{ color: "var(--text-primary)" }}
                      >
                        {row.domain}
                      </a>
                      {row.owner ? (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
                          {row.owner.isYourBrand ? "You" : row.owner.name}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 h-1 w-full max-w-48 rounded" style={{ background: "var(--gridline)" }}>
                      <div
                        className="h-1 rounded"
                        style={{
                          width: `${Math.max(3, (row.total / maxTotal) * 100)}%`,
                          background: row.owner?.isYourBrand ? "var(--series-1)" : "var(--de-emphasis)",
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.organicAppearances || "–"}
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.avgPosition != null ? formatPosition(Math.round(row.avgPosition * 10) / 10) : "–"}
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.aiOverviewCitations || "–"}
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.aiModeCitations || "–"}
                  </td>
                  <td className="px-3 py-2 text-right tabular" style={{ color: "var(--text-primary)" }}>
                    {row.keywords}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.owner?.isYourBrand ? null : (
                      <button
                        type="button"
                        onClick={() => onExclude(row.domain)}
                        className="rounded border px-2 py-0.5 text-xs opacity-60 group-hover:opacity-100 focus:opacity-100"
                        style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}
                        title="Exclude this blog / OTA from the leaderboard"
                      >
                        Hide
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
