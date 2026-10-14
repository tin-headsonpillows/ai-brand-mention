"use client";

import { useMemo, useState } from "react";
import type { SeAi, SeAiResult, SeVisible } from "@/lib/seranking/types";
import { ChartTableToggle, Delta, EmptyState, Panel, Segmented, type ChartView } from "@/components/tracking/ui";
import { TrendChart } from "@/components/tracking/TrendChart";
import { BarList, SectionError, Th, fmtInt, fmtPct } from "./shared";

const REC_LABEL: Record<string, string> = {
  secure_mentions: "Get mentioned on the sources AI cites most",
};

function engineName(e: { label: string; country: string | null; lang: string | null }) {
  return `${e.label}${e.country ? ` · ${e.country.toUpperCase()}` : ""}${e.lang ? `/${e.lang}` : ""}`;
}

/** One prompt × engine cell: mention position, link position, or why there's none. */
function ResultCell({ r }: { r: SeAiResult | undefined }) {
  if (!r) return <span style={{ color: "var(--text-muted)" }}>–</span>;
  if (r.mentionPos === null) return <span style={{ color: "var(--text-muted)" }} title="No AI answer block on this date">no answer</span>;
  const mentioned = r.mentionPos > 0;
  const moved = r.prevMentionPos !== null && r.prevMentionPos !== r.mentionPos;
  return (
    <span className="flex flex-col">
      <span className="whitespace-nowrap font-semibold" style={{ color: mentioned ? "var(--text-primary)" : "var(--text-muted)" }} title={mentioned ? `Brand mentioned at position ${r.mentionPos} of ${r.mentionsCount ?? "?"}` : "Brand not mentioned"}>
        {mentioned ? `#${r.mentionPos}` : "not mentioned"}
        {moved ? (
          <span className="ml-1 text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
            (was {r.prevMentionPos ? `#${r.prevMentionPos}` : "–"})
          </span>
        ) : null}
      </span>
      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        {r.urlPos && r.urlPos > 0 ? `linked #${r.urlPos}` : "not linked"}
      </span>
    </span>
  );
}

export function AiSection({ ai, visible, errors }: { ai: SeAi | null; visible: SeVisible | null; errors: { ai?: string; aiSources?: string } }) {
  const [view, setView] = useState<ChartView>("chart");
  const [metric, setMetric] = useState<"mention" | "link">("mention");
  const engines = useMemo(() => ai?.engines ?? [], [ai]);

  const chart = useMemo(() => {
    const dates = [...new Set(engines.flatMap((e) => e.trend.map((t) => t.date)))].sort();
    return {
      dates,
      series: engines.map((e, i) => {
        const byDate = new Map(e.trend.map((t) => [t.date, t[metric]]));
        return { id: String(e.id), label: engineName(e), color: `var(--series-${(i % 8) + 1})`, values: dates.map((d) => byDate.get(d) ?? null) };
      }),
    };
  }, [engines, metric]);

  if (!ai && !visible) {
    return (
      <div className="flex flex-col gap-3">
        <SectionError message={errors.ai} />
        <EmptyState
          title="No AI prompts tracked for this project"
          body="Add AI engines and prompts in SE Ranking's AI Results Tracker (ChatGPT, Google AI Overview, AI Mode, Perplexity, Gemini) - they appear here after the next sync."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionError message={errors.ai} />
      {ai ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {engines.map((e) => (
              <section key={e.id} className="flex flex-col gap-2 rounded-xl border p-4" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {engineName(e)}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {e.promptsCount} prompts
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col">
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Brand mentioned
                    </span>
                    <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                      {fmtPct(e.mentionPct)}
                    </span>
                    <Delta value={e.mentionDiff} format={(v) => `${v} pts`} title="change over 30 days" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Site linked
                    </span>
                    <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                      {fmtPct(e.linkPct)}
                    </span>
                    <Delta value={e.linkDiff} format={(v) => `${v} pts`} title="change over 30 days" />
                  </div>
                </div>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {e.aioPct !== null ? `AI Overview shown for ${fmtPct(e.aioPct)} of prompts` : e.sourcesPct !== null ? `${fmtPct(e.sourcesPct)} of answers cite sources` : ""}
                  {e.overlapPct !== null ? ` · ${fmtPct(e.overlapPct)} overlap with organic top 20` : ""}
                  {e.lastUpdate ? ` · checked ${e.lastUpdate}` : ""}
                </span>
              </section>
            ))}
          </div>

          {chart.dates.length > 1 ? (
            <Panel
              title="Presence over time"
              subtitle="share of tracked prompts per AI engine, last 30 days"
              actions={
                <span className="flex items-center gap-2">
                  <Segmented
                    value={metric}
                    onChange={setMetric}
                    ariaLabel="Metric"
                    options={[
                      { value: "mention", label: "Brand mentioned" },
                      { value: "link", label: "Site linked" },
                    ]}
                  />
                  <ChartTableToggle view={view} onChange={setView} />
                </span>
              }
            >
              <TrendChart dates={chart.dates} series={chart.series} format={(v) => `${Math.round(v)}%`} axisFormat={(v) => `${v}%`} maxDomain={100} view={view} ariaLabel="AI presence over time" />
            </Panel>
          ) : null}

          <Panel title="Prompts" subtitle={`${ai.prompts.length} prompts${ai.brand ? ` · tracking the brand "${ai.brand}"` : ""} · latest check per engine`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: `${360 + engines.length * 130}px` }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)" }}>
                    <Th>Prompt</Th>
                    <Th align="right">Volume</Th>
                    {engines.map((e) => (
                      <Th key={e.id}>{engineName(e)}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ai.prompts.map((p) => (
                    <tr key={p.text} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
                      <td className="py-2 pr-3 font-medium" style={{ color: "var(--text-primary)" }}>
                        {p.text}
                        {p.intent?.length ? (
                          <span className="ml-1.5 text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
                            {p.intent.join(" ")}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {fmtInt(p.volume)}
                      </td>
                      {engines.map((e) => (
                        <td key={e.id} className="py-2 pr-3">
                          <ResultCell r={p.engines[String(e.id)]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ai.prompts.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No prompt results in the last 7 days.
              </p>
            ) : null}
          </Panel>

          <SectionError message={errors.aiSources} />
          {ai.sources ? (
            <>
              <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Mention opportunities">
                {[
                  ["Mention opportunities", ai.sources.summary.opportunities, "Cited sources that mention 2+ brands but not yours"],
                  ["Competitor-only sources", ai.sources.summary.competitorOnly, "Cited sources that mention a competitor but not you"],
                  ["New this month", ai.sources.summary.newOpportunities, "Opportunity sources first seen in the last 30 days"],
                  ["Mentions without a link", ai.sources.summary.withoutBacklinks, "Sources that mention you but don't link to your site"],
                ].map(([label, value, hint]) => (
                  <div key={label as string} className="flex flex-col rounded-xl border p-3" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }} title={hint as string}>
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {label}
                    </span>
                    <span className="tabular text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
                      {fmtInt(value as number)}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {hint}
                    </span>
                  </div>
                ))}
              </section>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Panel title="Brands mentioned" subtitle="mentions in AI answers, last 30 days, all engines">
                  <BarList
                    rows={ai.sources.brands.map((b) => {
                      const own = !!ai.brand && b.name.toLowerCase() === ai.brand.toLowerCase();
                      return {
                        key: b.name,
                        label: <span style={own ? { fontWeight: 600, color: "var(--text-primary)" } : undefined}>{own ? `${b.name} (you)` : b.name}</span>,
                        value: b.inAnswers,
                        title: `${b.inSources} mentions in cited source pages`,
                      };
                    })}
                  />
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Hover a row for the brand&apos;s mentions in the source pages AI cites.
                  </p>
                </Panel>
                <Panel title="Most-cited sources" subtitle="domains AI answers cite, and whether they mention you">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-xs">
                      <thead>
                        <tr style={{ color: "var(--text-muted)" }}>
                          <Th>Domain</Th>
                          <Th align="right">AI answers</Th>
                          <Th align="right">Prompts</Th>
                          <Th align="right">DT</Th>
                          <Th>Mentions you</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {ai.sources.domains.map((d) => (
                          <tr key={d.domain} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                            <td className="py-1.5 pr-3 font-medium" style={{ color: "var(--text-primary)" }}>
                              {d.domain}
                              {d.isProject ? <span style={{ color: "var(--text-muted)" }}> (you)</span> : d.isCompetitor ? <span style={{ color: "var(--text-muted)" }}> (competitor)</span> : null}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular">{fmtInt(d.aiAnswers)}</td>
                            <td className="py-1.5 pr-3 text-right tabular">{fmtInt(d.prompts)}</td>
                            <td className="py-1.5 pr-3 text-right tabular">{fmtInt(d.dt)}</td>
                            <td className="py-1.5 pr-3" style={{ color: d.brandMentioned ? "var(--success-text)" : "var(--text-muted)" }}>
                              {d.brandMentioned ? "✓ yes" : "no - opportunity"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {ai.sources.recommendations.length ? (
                    <ul className="flex flex-col gap-1 border-t pt-2 text-xs" style={{ borderColor: "var(--gridline)", color: "var(--text-secondary)" }}>
                      {ai.sources.recommendations.map((r) => (
                        <li key={`${r.code}-${r.domain ?? ""}`}>
                          → {REC_LABEL[r.code] ?? `Get mentioned on ${r.domain ?? r.code}`}
                          {r.count ? ` (cited ${r.count} times without mentioning you)` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Panel>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {visible ? (
        <Panel title="SE Visible" subtitle={`${visible.domain} · ${visible.models.join(", ")}${visible.checkedAt ? ` · checked ${visible.checkedAt.slice(0, 10)}` : ""} · last 30 days`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <Th>Brand</Th>
                  <Th align="right">Visibility</Th>
                  <Th align="right">Share of voice</Th>
                  <Th align="right">Avg. position</Th>
                  <Th align="right">Sentiment</Th>
                  <Th align="right">Mentions</Th>
                </tr>
              </thead>
              <tbody>
                {visible.brands.map((b) => (
                  <tr key={b.name} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                    <td className="py-1.5 pr-3 font-medium" style={{ color: "var(--text-primary)" }}>
                      {b.name}
                      {b.isPrimary ? <span style={{ color: "var(--text-muted)" }}> (you)</span> : null}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular">{fmtPct(b.visibility)}</td>
                    <td className="py-1.5 pr-3 text-right tabular">{fmtPct(b.shareOfVoice)}</td>
                    <td className="py-1.5 pr-3 text-right tabular">{b.avgPosition === null ? "–" : b.avgPosition.toFixed(1)}</td>
                    <td className="py-1.5 pr-3 text-right tabular">{b.sentiment === null ? "–" : Math.round(b.sentiment)}</td>
                    <td className="py-1.5 pr-3 text-right tabular">{fmtInt(b.mentions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <Th>Prompt</Th>
                  <Th align="right">Visibility</Th>
                  <Th align="right">Share of voice</Th>
                  <Th align="right">Avg. position</Th>
                  <Th>Top brands</Th>
                </tr>
              </thead>
              <tbody>
                {visible.prompts.map((p) => (
                  <tr key={p.text} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                    <td className="py-1.5 pr-3" style={{ color: "var(--text-primary)" }}>
                      {p.text}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular">{fmtPct(p.visibility)}</td>
                    <td className="py-1.5 pr-3 text-right tabular">{fmtPct(p.shareOfVoice)}</td>
                    <td className="py-1.5 pr-3 text-right tabular">{p.avgPosition === null ? "–" : p.avgPosition.toFixed(1)}</td>
                    <td className="py-1.5 pr-3" style={{ color: "var(--text-secondary)" }}>
                      {p.topBrands.join(", ") || "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
