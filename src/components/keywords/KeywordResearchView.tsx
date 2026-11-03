"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Intent, KeywordResearch, KeywordStep, Priority, UrlStatus } from "@/lib/keywords/types";
import { Chip, EmptyState, Headline, Panel, SelectControl, inputStyle } from "@/components/tracking/ui";
import { BarList, Th, fmtInt } from "@/components/seranking/shared";
import { StepList, buttonStyle, secondaryButtonStyle, type StepState } from "@/components/ProjectScopedTab";

interface Payload {
  research: KeywordResearch;
  project: { brand: { name: string; website: string }; settings: { country: string; language: string } };
  hasKnowledgeBase: boolean;
  live: { openai: boolean; serp: boolean; seRanking: boolean };
}

const STEP_LABEL: Record<KeywordStep, string> = {
  taxonomy: "1 · Taxonomy: sub-categories and seed keywords",
  volume: "3 · Volume validation for the country",
  serp: "2 · Live SERP intent: Google results per keyword",
  finish: "4-6 · Clustering, URL mapping and priority",
};
const ORDER: KeywordStep[] = ["taxonomy", "volume", "serp", "finish"];
const PRI: Record<Priority, string> = { P1: "var(--status-good)", P2: "var(--status-warning)", P3: "var(--de-emphasis)" };
const URLSTAT: Record<UrlStatus, string> = { "ranking page": "Ranking page", "existing page": "Existing page", "new page": "New page needed" };
const INTENTS: Intent[] = ["transactional", "commercial", "local", "informational", "navigational"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const muted = { color: "var(--text-muted)" };
const td = "py-2 pr-3";

function Dot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

function Table({ head, children, minWidth }: { head: ReactNode; children: ReactNode; minWidth?: number }) {
  return (
    <div className="max-h-[34rem] overflow-auto">
      <table className="w-full text-xs" style={{ minWidth }}>
        <thead className="sticky top-0" style={{ background: "var(--surface-1)", color: "var(--text-secondary)" }}>
          <tr className="border-b" style={{ borderColor: "var(--border-hairline)" }}>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function KeywordResearchView({ projectId, onOpenKnowledgeBase, onRunFinished }: { projectId: string; onOpenKnowledgeBase: () => void; onRunFinished: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<KeywordStep, { state: StepState; detail?: string }> | null>(null);
  const [maxSerp, setMaxSerp] = useState("40");
  const [cluster, setCluster] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sub, setSub] = useState("all");
  const [intent, setIntent] = useState("all");
  const [priority, setPriority] = useState("all");

  const load = useCallback(async () => {
    const res = await fetch(`/api/keywords?project=${encodeURIComponent(projectId)}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      setError(`Couldn't load keyword research${res ? ` (status ${res.status})` : ""}`);
      return;
    }
    setData((await res.json()) as Payload);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) await load();
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const call = useCallback(
    async (step: KeywordStep, extra: Record<string, unknown> = {}) => {
      const res = await fetch("/api/keywords/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId, step, ...extra }) }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { research?: KeywordResearch; remaining?: number; error?: string };
      if (!res?.ok || !body.research) throw new Error(body.error ?? "Request failed");
      setData((d) => (d ? { ...d, research: body.research as KeywordResearch } : d));
      return body;
    },
    [projectId]
  );

  /** Runs the given steps in order; the SERP step repeats until every keyword in the budget is checked. */
  const run = useCallback(
    async (which: KeywordStep[], volumeExtra: Record<string, unknown> = {}) => {
      setRunning(true);
      setError(null);
      setCluster(null);
      const state = Object.fromEntries(ORDER.map((s) => [s, { state: (which.includes(s) ? "waiting" : "skipped") as StepState }])) as Record<KeywordStep, { state: StepState; detail?: string }>;
      setSteps({ ...state });
      for (const step of which) {
        state[step] = { state: "running" };
        setSteps({ ...state });
        try {
          if (step === "serp") {
            for (;;) {
              const out = await call("serp", { maxSerp: Number(maxSerp) });
              state.serp = { state: "running", detail: `${out.remaining ?? 0} left` };
              setSteps({ ...state });
              if (!out.remaining) break;
            }
          } else {
            await call(step, step === "volume" ? volumeExtra : {});
          }
          state[step] = { state: "done" };
        } catch (err) {
          state[step] = { state: "error", detail: err instanceof Error ? err.message : "Failed" };
          for (const rest of which.slice(which.indexOf(step) + 1)) state[rest] = { state: "skipped" };
          setSteps({ ...state });
          break;
        }
        setSteps({ ...state });
      }
      setRunning(false);
      onRunFinished();
    },
    [call, maxSerp, onRunFinished]
  );

  const uploadVolumes = useCallback(
    async (file: File) => {
      const text = await file.text();
      await run(["volume", "finish"], { csv: text, csvName: file.name });
    },
    [run]
  );

  const r = data?.research;
  const stats = useMemo(() => {
    if (!r) return null;
    const checked = r.keywords.filter((k) => k.serp && !k.serp.error);
    const validated = r.keywords.filter((k) => k.volumeStatus === "validated");
    const total = r.keywords.reduce((s, k) => s + (k.volume ?? 0), 0) || 1;
    const bySub = new Map<string, number>();
    r.keywords.forEach((k) => bySub.set(k.subcategory, (bySub.get(k.subcategory) ?? 0) + (k.volume ?? 0)));
    const count = (vals: string[]) => vals.reduce<Record<string, number>>((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {});
    const feats = count(checked.flatMap((k) => k.serp?.features ?? []));
    return {
      checked: checked.length,
      validated: validated.length,
      volume: validated.reduce((s, k) => s + (k.volume ?? 0), 0),
      aio: checked.length ? checked.filter((k) => k.aiOverview).length / checked.length : null,
      top10: checked.length ? checked.filter((k) => k.brandRank && k.brandRank <= 10).length / checked.length : null,
      p1: r.clusters.filter((c) => c.priority === "P1").length,
      bySub: [...bySub.entries()].map(([name, v]) => ({ name, share: v / total, volume: v })).sort((a, b) => b.share - a.share),
      intents: Object.entries(count(r.keywords.map((k) => k.intent))).map(([name, n]) => ({ name, share: n / r.keywords.length, n })).sort((a, b) => b.n - a.n),
      features: Object.entries(feats).map(([name, n]) => ({ name, share: n / (checked.length || 1), n })).sort((a, b) => Number(b.name === "AI Overview") - Number(a.name === "AI Overview") || b.n - a.n),
      volStatus: Object.entries(count(r.keywords.map((k) => k.volumeStatus))).map(([name, n]) => ({ name, share: n / r.keywords.length, n })),
      subs: [...new Set(r.keywords.map((k) => k.subcategory))],
    };
  }, [r]);

  if (error && !data) return <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>{error}</p>;
  if (!data || !r || !stats) return <p className="text-sm" style={muted}>Loading...</p>;

  const clusterPriority = new Map(r.clusters.map((c) => [c.id, c.priority]));
  const clusterName = new Map(r.clusters.map((c) => [c.id, c.name]));
  const keywords = r.keywords
    .filter((k) => (!cluster || clusterName.get(k.clusterId) === cluster) && (sub === "all" || k.subcategory === sub) && (intent === "all" || k.intent === intent) &&
      (priority === "all" || clusterPriority.get(k.clusterId) === priority) && (!q || k.keyword.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  const sourceNotes = [
    !data.live.openai ? "no OpenAI key: taxonomy built from the knowledge base's offerings" : "",
    !data.live.seRanking ? "no SE Ranking key: sample volumes unless you upload a file" : "",
    !data.live.serp ? "no SerpApi key: sample Google results" : "",
  ].filter(Boolean);

  const controls = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={running} onClick={() => void run(ORDER)} className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50" style={buttonStyle}>
          {running ? "Researching..." : r.keywords.length ? "Run keyword research again" : "Run keyword research"}
        </button>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          Live Google checks
          <SelectControl value={maxSerp} onChange={setMaxSerp} ariaLabel="Live Google checks" options={[{ value: "20", label: "20 keywords" }, { value: "40", label: "40 keywords" }, { value: "80", label: "80 keywords" }, { value: "150", label: "150 keywords" }]} />
        </label>
        {r.keywords.length ? (
          <label className="cursor-pointer rounded-lg border px-3 py-1.5 text-xs" style={secondaryButtonStyle}>
            Upload volumes (CSV/TSV)
            <input id="kw-volume-file" type="file" accept=".csv,.tsv,.txt" className="sr-only" disabled={running} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadVolumes(f); }} />
          </label>
        ) : null}
        <span className="text-xs" style={muted}>
          {r.updatedAt ? `Updated ${new Date(r.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Not run yet"}
          {r.volumeSource ? ` · volumes: ${r.volumeSource}` : ""}
        </span>
      </div>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Each live check is one SerpApi search on the highest-volume keywords{data.live.seRanking ? "; volumes cost SE Ranking 100 credits per 1,000 keywords" : ""}. Volume files: Keyword Planner, SE Ranking, Ahrefs, Semrush or any export with keyword and volume columns.
      </p>
      {sourceNotes.length ? <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Mock mode: {sourceNotes.join("; ")}.</p> : null}
      {!data.hasKnowledgeBase ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Tip: <button type="button" onClick={onOpenKnowledgeBase} className="underline">build the Brand Knowledge Base</button> first. The taxonomy comes from its offerings, personas and real Google queries.
        </p>
      ) : null}
      {steps ? <StepList steps={ORDER.map((s) => ({ key: s, label: STEP_LABEL[s], ...steps[s] }))} /> : null}
      {error ? <p className="text-xs" role="alert" style={{ color: "var(--status-critical)" }}>{error}</p> : null}
    </div>
  );

  if (!r.keywords.length) {
    return (
      <EmptyState
        title={`Keyword research for ${data.project.brand.name || "this project"}`}
        body="Six steps: taxonomy from the knowledge base, live Google intent and SERP features (AI Overviews included), country-level volume from SE Ranking or your file, clustering by shared results, a target page per cluster, and P1-P3 priorities."
        action={controls}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Keyword research" subtitle={r.category ? `Category: ${r.category}` : undefined}>
        {controls}
      </Panel>

      <div className="grid grid-cols-2 gap-4 rounded-xl border p-4 md:grid-cols-5" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
        <Headline label="Keywords" value={fmtInt(r.keywords.length)} />
        <Headline label="Monthly searches (validated)" value={fmtInt(stats.volume)} />
        <Headline label="AI Overview on results checked" value={pct(stats.aio)} />
        <Headline label="Brand in Google's top 10" value={pct(stats.top10)} />
        <Headline label="P1 clusters" value={String(stats.p1)} />
      </div>

      {r.clusters.length ? (
        <Panel title="Keyword plan by priority" subtitle="Keywords sharing 3+ top-10 results are one cluster, mapped to a page and ranked by volume, intent value and ranking gap. Click a cluster to list its keywords.">
          <Table minWidth={760} head={<><Th>Priority</Th><Th>Cluster</Th><Th align="right">Keywords</Th><Th align="right">Volume</Th><Th>Intent</Th><Th align="right">AI Overview</Th><Th align="right">Brand rank</Th><Th>Target page</Th></>}>
            {[...r.clusters].sort((a, b) => b.score - a.score).map((c) => (
              <tr
                key={c.id}
                onClick={() => setCluster((cur) => (cur === c.name ? null : c.name))}
                className="cursor-pointer border-b align-top"
                aria-selected={cluster === c.name}
                style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)", background: cluster === c.name ? "var(--page-plane)" : undefined }}
              >
                <td className={td}><Dot color={PRI[c.priority]}>{c.priority}</Dot></td>
                <td className={td}>{c.name}<div style={muted}>{c.subcategory}</div></td>
                <td className={`${td} text-right`}>{c.keywords.length}</td>
                <td className={`${td} text-right`}>{fmtInt(c.totalVolume)}</td>
                <td className={td}>{cap(c.intent)}</td>
                <td className={`${td} text-right`}>{pct(c.aiOverviewShare)}</td>
                <td className={`${td} text-right`}>{c.bestBrandRank ? `#${c.bestBrandRank}` : "Not top 10"}</td>
                <td className={`${td} break-all`}>
                  <span style={{ color: "var(--text-secondary)" }}>{c.targetUrl}</span>
                  <div className="mt-1"><Chip tone={c.urlStatus === "new page" ? "accent" : "muted"}>{URLSTAT[c.urlStatus]}</Chip></div>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : (
        <p className="text-xs" style={muted}>Clusters appear after the last step finishes.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="1 · Taxonomy" subtitle="Share of monthly volume per sub-category">
          <BarList rows={stats.bySub.map((s) => ({ key: s.name, label: s.name, value: s.share, title: `${fmtInt(s.volume)} searches a month` }))} max={1} format={(v) => `${Math.round(v * 100)}%`} />
        </Panel>
        <Panel title="2 · Search intent" subtitle="From the wording, SE Ranking and the live results">
          <BarList rows={stats.intents.map((s) => ({ key: s.name, label: cap(s.name), value: s.share, title: `${s.n} keywords` }))} max={1} format={(v) => `${Math.round(v * 100)}%`} />
        </Panel>
        <Panel title="2 · SERP features" subtitle={`On the ${stats.checked} keywords checked live`}>
          {stats.features.length ? (
            <BarList rows={stats.features.map((s) => ({ key: s.name, label: s.name, value: s.share, title: `${s.n} keywords` }))} max={1} format={(v) => `${Math.round(v * 100)}%`} />
          ) : (
            <p className="text-xs" style={muted}>No live checks yet.</p>
          )}
        </Panel>
        <Panel title="3 · Volume validation" subtitle={`${stats.validated} of ${r.keywords.length} keywords have a monthly volume${r.volumeSource ? ` · ${r.volumeSource}` : ""}`}>
          <BarList rows={stats.volStatus.map((s) => ({ key: s.name, label: cap(s.name), value: s.share, title: `${s.n} keywords` }))} max={1} format={(v) => `${Math.round(v * 100)}%`} />
        </Panel>
      </div>

      <Panel title="Keyword list" subtitle={cluster ? `Cluster: ${cluster}` : `${keywords.length} keywords`} actions={cluster ? <button type="button" onClick={() => setCluster(null)} className="rounded-lg border px-2 py-1 text-xs" style={secondaryButtonStyle}>Show all clusters</button> : undefined}>
        <div className="flex flex-wrap gap-2">
          <input id="kw-search" aria-label="Search keywords" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keywords" className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs sm:max-w-xs" style={inputStyle} />
          <SelectControl value={sub} onChange={setSub} ariaLabel="Sub-category" options={[{ value: "all", label: "All sub-categories" }, ...stats.subs.map((s) => ({ value: s, label: s }))]} />
          <SelectControl value={intent} onChange={setIntent} ariaLabel="Intent" options={[{ value: "all", label: "All intents" }, ...INTENTS.map((i) => ({ value: i, label: cap(i) }))]} />
          <SelectControl value={priority} onChange={setPriority} ariaLabel="Priority" options={[{ value: "all", label: "All priorities" }, { value: "P1", label: "P1" }, { value: "P2", label: "P2" }, { value: "P3", label: "P3" }]} />
        </div>
        <Table minWidth={820} head={<><Th>Keyword</Th><Th>Cluster</Th><Th>Intent</Th><Th align="right">Volume</Th><Th align="right">KD</Th><Th align="right">Brand rank</Th><Th>Competitors ranking</Th><Th>SERP features</Th></>}>
          {keywords.map((k) => (
            <tr key={k.keyword} className="border-b align-top" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
              <td className={td}>{k.keyword}{k.volumeStatus !== "validated" ? <span className="ml-1"><Chip tone="muted">{k.volumeStatus}</Chip></span> : null}</td>
              <td className={td} style={muted}>{clusterName.get(k.clusterId) ?? "–"}</td>
              <td className={td}>{cap(k.intent)}</td>
              <td className={`${td} text-right`}>{fmtInt(k.volume)}</td>
              <td className={`${td} text-right`}>{fmtInt(k.kd)}</td>
              <td className={`${td} text-right`}>{k.brandRank ? `#${k.brandRank}` : k.serp ? "Not top 10" : "Not checked"}</td>
              <td className={td} style={{ color: "var(--text-secondary)" }}>{Object.entries(k.competitorRanks).sort((a, b) => a[1] - b[1]).map(([n, p]) => `${n} #${p}`).join(", ") || "–"}</td>
              <td className={td} style={muted}>{k.serp?.error ? `Check failed: ${k.serp.error}` : (k.serp?.features ?? []).join(", ") || "–"}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
