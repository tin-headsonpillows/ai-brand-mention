"use client";

import { useEffect, useMemo, useState } from "react";
import { MENTIONS_MODELS, fmtUsd, modelLabel } from "@/lib/chatgpt/pricing";
import { useElementWidth } from "@/components/tracking/useElementWidth";
import { ChartTableToggle, EmptyState, Panel, Segmented, type ChartView } from "@/components/tracking/ui";
import type { MentionsSettingsView } from "./settings";
import { ExportContext, ExportMenu } from "@/components/export/ExportMenu";
import type { ExportSection, ExportTable } from "@/lib/export/types";

interface Totals {
  calls: number;
  input: number;
  output: number;
  costUsd: number;
}

interface UsageDay {
  day: string;
  byModel: Record<string, Totals>;
  byKey: Record<string, Totals>;
  runs: number;
}

type Grain = "day" | "week" | "month";

/** Color follows the model: listed models keep their slot in list order; anything else shares one slot. */
const MODEL_COLOR = new Map(MENTIONS_MODELS.map((m, i) => [m.id, `var(--series-${i + 1})`]));
const OTHER_COLOR = "var(--series-7)";
/** The same model colors as hex, for exported charts (light-theme values of --series-1..5 and --series-7). */
const EXPORT_COLOR: Record<string, string> = Object.fromEntries([
  ...MENTIONS_MODELS.map((m, i) => [m.id, ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4"][i] ?? "4A3AA7"]),
  ["other", "4A3AA7"],
]);
const colorOf = (model: string) => MODEL_COLOR.get(model) ?? OTHER_COLOR;
const groupOf = (model: string) => (MODEL_COLOR.has(model) ? model : "other");
const groupLabel = (group: string) => (group === "other" ? "Other models" : modelLabel(group));

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const mondayOf = (day: string) => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return isoDay(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS);
};
const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");
const fmtTokens = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 10_000 ? `${Math.round(v / 1000)}k` : fmtInt(v));
const shortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

interface Bucket {
  key: string;
  label: string;
  title: string;
  from: string;
  to: string;
  byGroup: Record<string, number>;
  total: number;
  calls: number;
  runs: number;
}

/** The last 30 days, 12 weeks (Monday start) or 12 months, including empty ones. */
function buckets(days: UsageDay[], grain: Grain, now: number): Bucket[] {
  const list: Bucket[] = [];
  if (grain === "day") {
    for (let i = 29; i >= 0; i--) {
      const d = isoDay(now - i * DAY_MS);
      list.push({ key: d, label: shortDate(d), title: shortDate(d), from: d, to: d, byGroup: {}, total: 0, calls: 0, runs: 0 });
    }
  } else if (grain === "week") {
    const thisMonday = Date.parse(`${mondayOf(isoDay(now))}T00:00:00Z`);
    for (let i = 11; i >= 0; i--) {
      const from = isoDay(thisMonday - i * 7 * DAY_MS);
      const to = isoDay(thisMonday - i * 7 * DAY_MS + 6 * DAY_MS);
      list.push({ key: from, label: shortDate(from), title: `Week of ${shortDate(from)}`, from, to, byGroup: {}, total: 0, calls: 0, runs: 0 });
    }
  } else {
    const d = new Date(now);
    for (let i = 11; i >= 0; i--) {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 0));
      const month = isoDay(start.getTime()).slice(0, 7);
      list.push({ key: month, label: start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), title: monthName(month), from: isoDay(start.getTime()), to: isoDay(end.getTime()), byGroup: {}, total: 0, calls: 0, runs: 0 });
    }
  }
  for (const day of days) {
    const b = list.find((x) => day.day >= x.from && day.day <= x.to);
    if (!b) continue;
    b.runs += day.runs;
    for (const [model, t] of Object.entries(day.byModel)) {
      const g = groupOf(model);
      b.byGroup[g] = (b.byGroup[g] ?? 0) + t.costUsd;
      b.total += t.costUsd;
      b.calls += t.calls;
    }
  }
  return list;
}

function sumRange(days: UsageDay[], from: string, to: string): { cost: number; calls: number; runs: number } {
  let cost = 0;
  let calls = 0;
  let runs = 0;
  for (const d of days) {
    if (d.day < from || d.day > to) continue;
    runs += d.runs;
    for (const t of Object.values(d.byModel)) {
      cost += t.costUsd;
      calls += t.calls;
    }
  }
  return { cost, calls, runs };
}

function StackedBars({ rows, groups, view }: { rows: Bucket[]; groups: string[]; view: ChartView }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const M = { top: 10, right: 12, bottom: 24, left: 52 };
  const iw = Math.max(1, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const max = Math.max(...rows.map((r) => r.total), 0);
  const step = (() => {
    const raw = (max || 0.01) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  })();
  const top = Math.max(step, Math.ceil((max || 0.01) / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const y = (v: number) => M.top + ih - (v / top) * ih;
  const slot = iw / rows.length;
  const barW = Math.max(4, Math.min(30, slot * 0.62));
  const x = (i: number) => M.left + slot * i + slot / 2;
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(iw / 56))));
  const h = hover !== null ? rows[hover] : null;

  if (view === "table") {
    return (
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1.5 pr-3 text-left font-medium">Period</th>
              {groups.map((g) => (
                <th key={g} className="py-1.5 pr-3 text-right font-medium">
                  {groupLabel(g)}
                </th>
              ))}
              <th className="py-1.5 pr-3 text-right font-medium">Total</th>
              <th className="py-1.5 text-right font-medium">Calls</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.key} className="border-t" style={{ borderColor: "var(--gridline)", color: "var(--text-primary)" }}>
                <td className="py-1.5 pr-3">{r.title}</td>
                {groups.map((g) => (
                  <td key={g} className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                    {r.byGroup[g] ? fmtUsd(r.byGroup[g]) : "–"}
                  </td>
                ))}
                <td className="py-1.5 pr-3 text-right font-medium tabular">{fmtUsd(r.total)}</td>
                <td className="py-1.5 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                  {fmtInt(r.calls)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          {groups.map((g) => (
            <li key={g} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: g === "other" ? OTHER_COLOR : colorOf(g) }} />
              {groupLabel(g)}
            </li>
          ))}
        </ul>
      ) : null}
      <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
        {width > 0 ? (
          <svg width={width} height={H} role="img" aria-label="API cost per period by model" className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--gridline)"} />
                <text x={M.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-muted)" className="tabular">
                  ${t.toFixed(step >= 1 ? 0 : step >= 0.1 ? 2 : step >= 0.01 ? 2 : 3)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              let acc = 0;
              const parts = groups.filter((g) => (r.byGroup[g] ?? 0) > 0);
              return (
                <g key={r.key} opacity={hover === null || hover === i ? 1 : 0.5}>
                  {parts.map((g, j) => {
                    const v = r.byGroup[g];
                    const yTop = y(acc + v);
                    const height = Math.max(1, y(acc) - yTop - (j > 0 ? 2 : 0));
                    acc += v;
                    return <rect key={g} x={x(i) - barW / 2} y={yTop} width={barW} height={height} rx={j === parts.length - 1 ? 2 : 0} fill={g === "other" ? OTHER_COLOR : colorOf(g)} />;
                  })}
                  {i % labelEvery === 0 || i === rows.length - 1 ? (
                    <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                      {r.label}
                    </text>
                  ) : null}
                  <rect x={M.left + slot * i} y={M.top} width={slot} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
        ) : (
          <div style={{ height: H }} />
        )}
        {h && hover !== null ? (
          <div
            className="pointer-events-none absolute z-10 min-w-44 rounded-lg border px-3 py-2 text-xs shadow-md"
            style={{
              top: 0,
              left: x(hover),
              transform: x(hover) > width / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              background: "var(--surface-1)",
              borderColor: "var(--border-hairline)",
              color: "var(--text-secondary)",
            }}
          >
            <div className="mb-1 font-semibold" style={{ color: "var(--text-primary)" }}>
              {h.title} · {fmtUsd(h.total)}
            </div>
            {groups
              .filter((g) => h.byGroup[g])
              .map((g) => (
                <div key={g} className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: g === "other" ? OTHER_COLOR : colorOf(g) }} />
                  {groupLabel(g)} {fmtUsd(h.byGroup[g])}
                </div>
              ))}
            <div style={{ color: "var(--text-muted)" }}>
              {fmtInt(h.calls)} calls · {fmtInt(h.runs)} runs
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function UsageView({ settings, onOpenSettings }: { settings: MentionsSettingsView | null; onOpenSettings: () => void }) {
  const [data, setData] = useState<{ days: UsageDay[]; keyLabels: Record<string, string>; now: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grain, setGrain] = useState<Grain>("day");
  const [view, setView] = useState<ChartView>("chart");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/chatgpt/usage", { cache: "no-store" }).catch(() => null);
      const body = res?.ok ? ((await res.json()) as { days: UsageDay[]; keyLabels: Record<string, string> }) : null;
      if (cancelled) return;
      if (body) setData({ ...body, now: Date.now() });
      else setError("Couldn't load usage.");
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => data?.days ?? [], [data]);
  const now = data?.now ?? 0;
  const rows = useMemo(() => buckets(days, grain, now), [days, grain, now]);
  // Only the models used in the period shown; each keeps its fixed color.
  const groups = useMemo(() => {
    const present = new Set(rows.flatMap((r) => Object.keys(r.byGroup)));
    return [...MENTIONS_MODELS.map((m) => m.id), "other"].filter((g) => present.has(g));
  }, [rows]);

  const today = isoDay(now);
  const byModel = useMemo(() => {
    const from = rows[0]?.from ?? "";
    const to = rows.at(-1)?.to ?? "";
    const out = new Map<string, Totals>();
    for (const d of days) {
      if (d.day < from || d.day > to) continue;
      for (const [model, t] of Object.entries(d.byModel)) {
        const cur = out.get(model) ?? { calls: 0, input: 0, output: 0, costUsd: 0 };
        cur.calls += t.calls;
        cur.input += t.input;
        cur.output += t.output;
        cur.costUsd += t.costUsd;
        out.set(model, cur);
      }
    }
    return [...out.entries()].sort((a, b) => b[1].costUsd - a[1].costUsd);
  }, [days, rows]);
  const rangeTotal = byModel.reduce((n, [, t]) => n + t.costUsd, 0);

  if (error) return <EmptyState title="Usage unavailable" body={error} />;
  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading usage...
      </p>
    );
  }

  const monthStart = `${today.slice(0, 7)}-01`;
  const tiles = [
    { label: "Today", ...sumRange(days, today, today) },
    { label: "This week", ...sumRange(days, mondayOf(today), today) },
    { label: "This month", ...sumRange(days, monthStart, today) },
    { label: "Last 12 months", ...sumRange(days, isoDay(now - 364 * DAY_MS), today) },
  ];
  const periodName = grain === "day" ? "last 30 days" : grain === "week" ? "last 12 weeks" : "last 12 months";

  // Export: the totals, cost by model per day / week / month, the by-model table and each key's spend.
  const usageSections = (): ExportSection[] => {
    const grains: Array<[Grain, string]> = [
      ["day", "Daily (last 30 days)"],
      ["week", "Weekly (last 12 weeks)"],
      ["month", "Monthly (last 12 months)"],
    ];
    const periodTable = (g: Grain, name: string): { table: ExportTable; rows: Bucket[]; groups: string[] } => {
      const rs = buckets(days, g, now);
      const gs = [...MENTIONS_MODELS.map((m) => m.id), "other"].filter((id) => rs.some((r) => r.byGroup[id]));
      return {
        rows: rs,
        groups: gs,
        table: {
          name,
          columns: [{ header: g === "day" ? "Day" : g === "week" ? "Week starting" : "Month", width: 16 }, ...gs.map((id) => ({ header: groupLabel(id), format: "usd" as const })), { header: "Total", format: "usd" }, { header: "API calls", format: "int" }, { header: "Runs", format: "int" }],
          rows: rs.map((r) => [g === "month" ? r.title : r.from, ...gs.map((id) => r.byGroup[id] ?? 0), r.total, r.calls, r.runs]),
        },
      };
    };
    const periods = grains.map(([g, name]) => periodTable(g, name));
    const modelTotals = new Map<string, Totals>();
    for (const d of days) {
      if (d.day < isoDay(now - 364 * DAY_MS)) continue;
      for (const [model, t] of Object.entries(d.byModel)) {
        const cur = modelTotals.get(model) ?? { calls: 0, input: 0, output: 0, costUsd: 0 };
        cur.calls += t.calls;
        cur.input += t.input;
        cur.output += t.output;
        cur.costUsd += t.costUsd;
        modelTotals.set(model, cur);
      }
    }
    const yearTotal = [...modelTotals.values()].reduce((n, t) => n + t.costUsd, 0);
    return [
      {
        title: "API spend",
        subtitle: "ChatGPT Mentions runs, from the token counts OpenAI returns, at list prices. Days are UTC.",
        facts: tiles.map((t) => [t.label, `$${t.cost.toFixed(2)} · ${t.runs} runs · ${t.calls} API calls`] as [string, string]),
        tables: [],
      },
      {
        title: "API cost by model",
        charts: periods.map((p, i) => ({
          title: `Cost by model - ${grains[i][1].toLowerCase()}`,
          categories: p.rows.map((r) => r.label),
          series: p.groups.map((id) => ({ name: groupLabel(id), values: p.rows.map((r) => r.byGroup[id] ?? 0), color: EXPORT_COLOR[id] })),
          format: "usd" as const,
          stacked: true,
          vertical: true,
        })),
        tables: periods.map((p) => p.table),
      },
      {
        title: "By model",
        subtitle: "Last 12 months",
        tables: [
          {
            name: "By model (12 months)",
            columns: [{ header: "Model", width: 22 }, { header: "Calls", format: "int" }, { header: "Input tokens", format: "int" }, { header: "Output tokens", format: "int" }, { header: "Cost", format: "usd" }, { header: "Share", format: "pct" }],
            rows: [...modelTotals.entries()].sort((a, b) => b[1].costUsd - a[1].costUsd).map(([m, t]) => [modelLabel(m), t.calls, t.input, t.output, t.costUsd, yearTotal ? t.costUsd / yearTotal : 0]),
          },
        ],
      },
      {
        title: "By API key",
        subtitle: "Spend today against each key's daily limit",
        tables: [
          {
            name: "By API key",
            columns: [{ header: "Key", width: 20 }, { header: "Spent today", format: "usd" }, { header: "Daily limit", format: "usd" }, { header: "Last 30 days", format: "usd" }],
            rows: (settings?.keys ?? []).map((k) => [
              k.label,
              k.spentTodayUsd,
              k.limitUsd,
              days.filter((d) => d.day >= isoDay(now - 29 * DAY_MS)).reduce((n, d) => n + (d.byKey[k.id]?.costUsd ?? 0), 0),
            ]),
          },
        ],
      },
    ];
  };

  return (
    <div className="flex flex-col gap-4">
      <ExportContext.Provider value={{ title: "ChatGPT Mentions", subtitle: `API usage and costs as of ${today} (UTC)`, fileStem: `ChatGPT Mentions - ${today}` }}>
        <div className="flex justify-end">
          <ExportMenu name="Usage and costs" label="Export usage & costs" sections={usageSections} />
        </div>
      </ExportContext.Provider>
      <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border p-4 md:grid-cols-4" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }} aria-label="API spend">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-0.5">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t.label}
            </span>
            <span className="text-3xl font-semibold tabular" style={{ color: "var(--text-primary)" }}>
              {fmtUsd(t.cost)}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {fmtInt(t.runs)} {t.runs === 1 ? "run" : "runs"} · {fmtInt(t.calls)} API calls
            </span>
          </div>
        ))}
      </section>

      <Panel
        title="API cost by model"
        subtitle={`${periodName} · days in UTC`}
        actions={<ChartTableToggle view={view} onChange={setView} />}
      >
        <div className="self-start">
          <Segmented
            value={grain}
            onChange={setGrain}
            ariaLabel="Group by"
            options={[
              { value: "day", label: "Daily" },
              { value: "week", label: "Weekly" },
              { value: "month", label: "Monthly" },
            ]}
          />
        </div>
        {groups.length ? (
          <StackedBars rows={rows} groups={groups} view={view} />
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {days.length ? "No API usage in this period." : "No API usage recorded yet. Usage is recorded for runs with a real OpenAI key (not simulated runs)."}
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="By model" subtitle={periodName}>
          {byModel.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr style={{ color: "var(--text-muted)" }}>
                    <th className="py-1.5 pr-3 text-left font-medium">Model</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Calls</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Input tokens</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Output tokens</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
                    <th className="py-1.5 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map(([model, t]) => (
                    <tr key={model} className="border-t" style={{ borderColor: "var(--gridline)", color: "var(--text-primary)" }}>
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(model) }} />
                          {modelLabel(model)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular">{fmtInt(t.calls)}</td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {fmtTokens(t.input)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {fmtTokens(t.output)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-medium tabular">{fmtUsd(t.costUsd)}</td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {rangeTotal ? `${Math.round((t.costUsd / rangeTotal) * 100)}%` : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No usage in this period.
            </p>
          )}
        </Panel>

        <Panel
          title="By API key"
          subtitle="today against each key's daily limit"
          actions={
            <button type="button" onClick={onOpenSettings} className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
              Set limits
            </button>
          }
        >
          {settings?.keys.length ? (
            <ul className="flex flex-col gap-3">
              {settings.keys.map((k) => {
                const share = k.limitUsd > 0 ? Math.min(1, k.spentTodayUsd / k.limitUsd) : 1;
                const range30 = days
                  .filter((d) => d.day >= isoDay(now - 29 * DAY_MS))
                  .reduce((n, d) => n + (d.byKey[k.id]?.costUsd ?? 0), 0);
                return (
                  <li key={k.id} className="flex flex-col gap-1 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                        {k.label}
                      </span>
                      <span className="tabular" style={{ color: "var(--text-secondary)" }}>
                        {fmtUsd(k.spentTodayUsd)} of {fmtUsd(k.limitUsd)} today
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded" style={{ background: "var(--meter-track)" }} role="img" aria-label={`${Math.round(share * 100)}% of today's limit used`}>
                      <span className="block h-2" style={{ width: `${share * 100}%`, background: share >= 1 ? "var(--status-critical)" : "var(--series-1)" }} />
                    </div>
                    <span style={{ color: "var(--text-muted)" }}>
                      {fmtUsd(range30)} in the last 30 days{share >= 1 ? " · limit reached - runs on this key are paused until midnight UTC" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No keys used yet.
            </p>
          )}
        </Panel>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Costs are calculated from the token counts OpenAI returns with each call, at list prices; OpenAI&apos;s invoice may differ slightly (e.g. cached-input discounts). Covers ChatGPT Mentions runs only - Brand Mentions has its own cost tracking.
      </p>
    </div>
  );
}
