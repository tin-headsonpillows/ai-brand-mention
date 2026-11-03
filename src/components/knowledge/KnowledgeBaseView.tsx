"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { KnowledgeBase, ResearchStep, CheckStatus, SerpResultType } from "@/lib/knowledge/types";
import { RESEARCH_STEPS } from "@/lib/knowledge/types";
import type { TrackedBrand } from "@/lib/tracking/types";
import { Chip, EmptyState, Headline, Panel, inputStyle } from "@/components/tracking/ui";
import { BarList, Th, fmtInt } from "@/components/seranking/shared";
import { StepList, buttonStyle, secondaryButtonStyle, type StepState } from "@/components/ProjectScopedTab";

interface Payload {
  kb: KnowledgeBase;
  project: { brand: TrackedBrand; settings: { country: string; language: string } };
  mock: { openai: boolean; serp: boolean };
}

const STEP_LABEL: Record<ResearchStep, string> = {
  site: "Read the website and check AI readiness",
  serp: "Search Google for the brand (SerpApi)",
  profile: "Write the brand profile (ChatGPT)",
  demand: "Search Google for buyer demand (SerpApi)",
};

const CHECK: Record<CheckStatus, { label: string; color: string; order: number }> = {
  fail: { label: "✕ Fix", color: "var(--status-critical)", order: 0 },
  warn: { label: "! Improve", color: "var(--status-warning)", order: 1 },
  info: { label: "i Choice", color: "var(--de-emphasis)", order: 2 },
  pass: { label: "✓ OK", color: "var(--status-good)", order: 3 },
};

const COMPETITOR_TYPE: Record<string, string> = { category_leader: "Category leader", direct: "Direct", marketplace: "Marketplace", alternative: "Alternative" };

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");

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
    <div className="max-h-[32rem] overflow-auto">
      <table className="w-full text-xs" style={{ minWidth }}>
        <thead className="sticky top-0" style={{ background: "var(--surface-1)", color: "var(--text-secondary)" }}>
          <tr className="border-b" style={{ borderColor: "var(--border-hairline)" }}>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b align-top" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
      {children}
    </tr>
  );
}
const td = "py-2 pr-3";
const muted = { color: "var(--text-muted)" };

export function KnowledgeBaseView({ projectId, onOpenSettings, onRunFinished }: { projectId: string; onOpenSettings: () => void; onRunFinished: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<ResearchStep, { state: StepState; detail?: string }> | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");
  const [author, setAuthor] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [queryFilter, setQueryFilter] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/knowledge?project=${encodeURIComponent(projectId)}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      setError(`Couldn't load the knowledge base${res ? ` (status ${res.status})` : ""}`);
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

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    const state = Object.fromEntries(RESEARCH_STEPS.map((s) => [s, { state: "waiting" as StepState }])) as Record<ResearchStep, { state: StepState; detail?: string }>;
    setSteps({ ...state });
    for (const step of RESEARCH_STEPS) {
      state[step] = { state: "running" };
      setSteps({ ...state });
      const res = await fetch("/api/knowledge/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId, step }) }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { kb?: KnowledgeBase; error?: string };
      if (res?.ok && body.kb) {
        state[step] = { state: "done" };
        setData((d) => (d ? { ...d, kb: body.kb as KnowledgeBase } : d));
      } else {
        state[step] = { state: "error", detail: body.error ?? "Request failed" };
        // A site that can't be crawled shouldn't stop the Google and ChatGPT steps; anything else stops the run.
        if (step !== "site") {
          for (const rest of RESEARCH_STEPS.slice(RESEARCH_STEPS.indexOf(step) + 1)) state[rest] = { state: "skipped" };
          setSteps({ ...state });
          break;
        }
      }
      setSteps({ ...state });
    }
    setRunning(false);
    onRunFinished();
  }, [projectId, onRunFinished]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/knowledge/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId, author, ...payload }) }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { kb?: KnowledgeBase; error?: string };
      if (res?.ok && body.kb) setData((d) => (d ? { ...d, kb: body.kb as KnowledgeBase } : d));
      else setError(body.error ?? "Couldn't save");
      return !!res?.ok;
    },
    [projectId, author]
  );

  const kb = data?.kb;
  const profile = kb?.profile ?? null;
  const summary = useMemo(() => {
    if (!kb) return null;
    const scored = (kb.site?.checks ?? []).filter((c) => c.status !== "info");
    const claims = profile?.differentiators ?? [];
    const queries = commonQueriesOf(kb);
    return {
      readiness: scored.length ? scored.filter((c) => c.status === "pass").length / scored.length : null,
      pass: scored.filter((c) => c.status === "pass").length,
      scored: scored.length,
      explicit: claims.length ? claims.filter((c) => c.evidenceType === "explicit").length / claims.length : null,
      explicitN: claims.filter((c) => c.evidenceType === "explicit").length,
      claims: claims.length,
      queries,
      open: (profile?.factsToVerify ?? []).filter((f) => !f.answer).length,
    };
  }, [kb, profile]);

  if (error && !data) return <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>{error}</p>;
  if (!data || !kb || !summary) return <p className="text-sm" style={muted}>Loading...</p>;

  const { brand } = data.project;
  const missingSetup = !brand.name || !brand.website;
  const researched = !!(kb.site || kb.serp || profile);
  const mockNotes = [data.mock.openai ? "no OPENAI_API_KEY: the profile is a sample" : "", data.mock.serp ? "no SerpApi key: Google results are samples" : ""].filter(Boolean);

  const runner = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={running || missingSetup} className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50" style={buttonStyle}>
          {running ? "Researching..." : researched ? "Run research again" : "Run research"}
        </button>
        {missingSetup ? (
          <button type="button" onClick={onOpenSettings} className="rounded-lg border px-3 py-1.5 text-sm" style={secondaryButtonStyle}>
            Set the brand name and website
          </button>
        ) : null}
        <span className="text-xs" style={muted}>
          {kb.updatedAt ? `Updated ${fmtWhen(kb.updatedAt)}` : "Not researched yet"}
          {kb.costUsd > 0 ? ` · AI cost so far $${kb.costUsd.toFixed(3)}` : ""}
        </span>
      </div>
      {mockNotes.length ? <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Mock mode: {mockNotes.join("; ")}.</p> : null}
      {steps ? <StepList steps={RESEARCH_STEPS.map((s) => ({ key: s, label: STEP_LABEL[s], ...steps[s] }))} /> : null}
      {error ? <p className="text-xs" role="alert" style={{ color: "var(--status-critical)" }}>{error}</p> : null}
    </div>
  );

  if (!researched) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          title={`Build the knowledge base for ${brand.name || "this project"}`}
          body="Reads the brand's website and checks whether AI crawlers can use it, searches Google for the brand and for what buyers ask, then has ChatGPT write the profile: offerings with proof, personas, differentiators, competitors and the questions to confirm with the client. It feeds Keyword Research and Brand Mentions."
          action={runner}
        />
      </div>
    );
  }

  const serpBrand = (kb.serp?.brand ?? []).filter((p) => p.kind !== "autocomplete");
  const serpRows = serpBrand.flatMap((p) => p.organic.map((o) => ({ ...o, query: p.query })));
  const typeCounts = serpRows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.type]: (m[r.type] ?? 0) + 1 }), {});
  const site = kb.site;
  const indexed = kb.serp?.brand.find((p) => p.kind === "site")?.totalResults ?? null;
  const panel = kb.serp?.brand.find((p) => Object.keys(p.knowledgeGraph).length)?.knowledgeGraph;
  const facts: Array<[string, string]> = [
    ["Brand", profile?.brandName || brand.name],
    ["Website", brand.website],
    ["Audit market", `${data.project.settings.country.toUpperCase()} · ${data.project.settings.language}`],
    ["Category", profile?.category ?? ""],
    ["What it does", profile?.oneLiner ?? ""],
    ["Business model", profile?.businessModel ?? ""],
    ["Price positioning", profile?.pricePositioning ?? ""],
    ["Markets", (profile?.markets ?? []).join(", ")],
    ["Buyer languages", (profile?.languages ?? []).join(", ")],
    ["Also written as", (profile?.aliases ?? []).join(", ")],
    ["Pages in Google (approx.)", indexed === null ? "" : fmtInt(indexed)],
    ["Google knowledge panel", kb.serp ? (panel ? `Yes: ${panel.title ?? ""}${panel.type ? ` (${panel.type})` : ""}` : "None shown") : ""],
    ["Research notes", profile?.researchNotes ?? ""],
  ].filter((r): r is [string, string] => !!r[1]);
  const queries = summary.queries.filter((q) => !queryFilter || `${q.query} ${q.seed}`.toLowerCase().includes(queryFilter.toLowerCase()));
  const resultTypeColor: Record<SerpResultType, string> = { "own site": "var(--series-1)", competitor: "var(--de-emphasis)", "review / directory": "var(--de-emphasis)", social: "var(--de-emphasis)", community: "var(--de-emphasis)", other: "var(--de-emphasis)" };

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Research" subtitle="Website, Google and ChatGPT, one step at a time">
        {runner}
      </Panel>

      <div className="grid grid-cols-2 gap-4 rounded-xl border p-4 md:grid-cols-4" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
        <Headline label="AI readiness (website checks passed)" value={pct(summary.readiness)} />
        <Headline label="Differentiators backed by explicit facts" value={pct(summary.explicit)} />
        <Headline label="Common buyer queries found" value={fmtInt(summary.queries.length)} />
        <Headline label="Open questions for the client" value={String(summary.open)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Project and brand identity" subtitle="Who the client is and how buyers know it">
          <Table head={<><Th>Field</Th><Th>Detail</Th></>}>
            {facts.map(([k, v]) => (
              <Row key={k}>
                <td className={`${td} w-40`} style={{ color: "var(--text-secondary)" }}>{k}</td>
                <td className={td}>{v}</td>
              </Row>
            ))}
          </Table>
        </Panel>

        <Panel title="Confirm with the client" subtitle="Gaps the research could not close">
          {profile?.factsToVerify.length ? (
            <ol className="flex flex-col gap-3">
              {profile.factsToVerify.map((f, i) => (
                <li key={`${i}-${f.question}`} className="flex flex-col gap-1.5 text-sm">
                  <span style={{ color: "var(--text-primary)" }}>{i + 1}. {f.question}</span>
                  {f.why ? <span className="text-xs" style={muted}>{f.why}</span> : null}
                  {f.answer ? (
                    <span className="text-xs">
                      <Chip tone="good">Answered</Chip> <span style={{ color: "var(--text-secondary)" }}>{f.answer}</span>
                    </span>
                  ) : (
                    <form
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await post({ action: "answer", index: i, answer: answers[i] ?? "" })) setAnswers((a) => ({ ...a, [i]: "" }));
                      }}
                    >
                      <input id={`kb-answer-${i}`} aria-label={`Client answer to: ${f.question}`} value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))} placeholder="Client's answer" className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs" style={inputStyle} />
                      <button type="submit" disabled={!answers[i]?.trim()} className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50" style={secondaryButtonStyle}>Save</button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm" style={muted}>No open questions.</p>
          )}
        </Panel>
      </div>

      <Panel title="Offerings and proof" subtitle="AI repeats explicit facts: prices, specs, numbers. An offering with no proof is hard to recommend.">
        <Table minWidth={640} head={<><Th>Offering</Th><Th>What it is</Th><Th>Proof on the site</Th><Th>Page</Th></>}>
          {(profile?.offerings ?? []).map((o) => (
            <Row key={o.name}>
              <td className={td}>
                {o.name}
                {o.productNames.length ? <div className="mt-1"><Chip tone="muted">{o.productNames.join(", ")}</Chip></div> : null}
              </td>
              <td className={td}>{o.description}</td>
              <td className={td}>{o.proofPoints.length ? o.proofPoints.join(" · ") : <Dot color="var(--status-warning)">No explicit proof found</Dot>}</td>
              <td className={`${td} break-all`} style={muted}>{o.sourceUrl || "–"}</td>
            </Row>
          ))}
        </Table>
      </Panel>

      <Panel title="Buyer personas" subtitle="The prompt set is written from these">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(profile?.personas ?? []).map((p) => (
            <div key={p.name} className="flex flex-col gap-2 rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{p.name}</p>
              {p.description ? <p style={{ color: "var(--text-secondary)" }}>{p.description}</p> : null}
              {([["Pain points", p.painPoints], ["Compares on", p.decisionCriteria], ["Would ask AI", p.typicalQuestions]] as const).map(([label, items]) =>
                items.length ? (
                  <div key={label}>
                    <p className="font-medium" style={muted}>{label}</p>
                    <ul className="list-disc pl-4" style={{ color: "var(--text-primary)" }}>{items.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                ) : null
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Differentiators: explicit or self-claimed" subtitle={`${summary.explicitN} of ${summary.claims} backed by a checkable fact`}>
        <Table minWidth={560} head={<><Th>Type</Th><Th>Claim</Th><Th>Evidence</Th><Th>Page</Th></>}>
          {[...(profile?.differentiators ?? [])].sort((a, b) => Number(a.evidenceType === "explicit") - Number(b.evidenceType === "explicit")).map((d) => (
            <Row key={d.claim}>
              <td className={td}>{d.evidenceType === "explicit" ? <Dot color="var(--status-good)">Explicit</Dot> : <Dot color="var(--status-warning)">Self-claimed</Dot>}</td>
              <td className={td}>{d.claim}</td>
              <td className={td} style={d.evidence ? undefined : muted}>{d.evidence || "–"}</td>
              <td className={`${td} break-all`} style={muted}>{d.sourceUrl || "–"}</td>
            </Row>
          ))}
        </Table>
      </Panel>

      {site ? (
        <>
          <Panel title="AI readiness of the website" subtitle={`${summary.pass} of ${summary.scored} checks pass · problems first`}>
            {site.warnings.map((w) => <p key={w} className="text-xs" style={{ color: "var(--text-secondary)" }}>{w}</p>)}
            <Table minWidth={560} head={<><Th>Result</Th><Th>Check</Th><Th>Area</Th><Th>Detail</Th></>}>
              {[...site.checks].sort((a, b) => CHECK[a.status].order - CHECK[b.status].order).map((c) => (
                <Row key={c.id}>
                  <td className={td}><Dot color={CHECK[c.status].color}>{CHECK[c.status].label}</Dot></td>
                  <td className={td}>{c.check}</td>
                  <td className={td} style={muted}>{c.group}</td>
                  <td className={td} style={{ color: "var(--text-secondary)" }}>{c.detail}</td>
                </Row>
              ))}
            </Table>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="AI crawler access" subtitle="What robots.txt allows">
              <Table head={<><Th>Crawler</Th><Th>Used for</Th><Th>Access</Th></>}>
                {[...site.bots].sort((a, b) => Number(a.allowed) - Number(b.allowed)).map((b) => (
                  <Row key={b.bot}>
                    <td className={td}>{b.bot}<div style={muted}>{b.operator} · {b.purpose}</div></td>
                    <td className={td} style={{ color: "var(--text-secondary)" }}>{b.what}</td>
                    <td className={td}>{b.allowed ? <Dot color="var(--status-good)">Allowed</Dot> : <Dot color={b.purpose === "training" ? "var(--status-warning)" : "var(--status-critical)"}>Blocked</Dot>}</td>
                  </Row>
                ))}
              </Table>
            </Panel>
            <Panel title="Entity signals and research sources" subtitle={`${site.pages.length} pages read · ${fmtWhen(site.fetchedAt)}`}>
              <Table head={<><Th>Signal</Th><Th>Value</Th></>}>
                {site.entity.map((e) => (
                  <Row key={`${e.kind}-${e.value}`}>
                    <td className={td} style={muted}>{e.kind === "same_as" ? "Official profile" : "Schema type"}</td>
                    <td className={`${td} break-all`}>{e.value}</td>
                  </Row>
                ))}
                {site.pages.map((p) => (
                  <Row key={p.url}>
                    <td className={td} style={muted}>Page read</td>
                    <td className={`${td} break-all`}>{p.title || p.url}<div style={muted}>{p.url}</div></td>
                  </Row>
                ))}
              </Table>
            </Panel>
          </div>
        </>
      ) : null}

      {serpRows.length ? (
        <Panel title="Google search presence" subtitle={`What ranks for ${brand.name}, its reviews and its site${kb.serp?.mock ? " · sample results" : ""}`}>
          <BarList
            rows={Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ key: t, label: t, value: n / serpRows.length, color: resultTypeColor[t as SerpResultType] }))}
            max={1}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Table minWidth={620} head={<><Th>Search</Th><Th align="right">Rank</Th><Th>Result</Th><Th>Type</Th><Th>Website</Th></>}>
            {serpRows.map((r) => (
              <Row key={`${r.query}-${r.position}-${r.link}`}>
                <td className={td} style={muted}>{r.query}</td>
                <td className={`${td} text-right`}>{r.position}</td>
                <td className={td}>{r.title}</td>
                <td className={td}>{r.type}</td>
                <td className={td} style={muted}>{r.domain}</td>
              </Row>
            ))}
          </Table>
        </Panel>
      ) : null}

      {summary.queries.length ? (
        <Panel title="Common buyer queries" subtitle="People also ask, related searches and autocomplete: real demand that grounds the prompts and keywords">
          <input id="kb-query-filter" aria-label="Search common queries" value={queryFilter} onChange={(e) => setQueryFilter(e.target.value)} placeholder="Search queries" className="w-full max-w-sm rounded-lg border px-2 py-1 text-xs" style={inputStyle} />
          <Table head={<><Th>Query</Th><Th>Found in</Th><Th>From the search</Th></>}>
            {queries.map((q) => (
              <Row key={q.query}>
                <td className={td}>{q.query}</td>
                <td className={td} style={{ color: "var(--text-secondary)" }}>{q.source}</td>
                <td className={td} style={muted}>{q.seed}</td>
              </Row>
            ))}
          </Table>
        </Panel>
      ) : null}

      {profile?.competitors.length ? (
        <Panel title="Competitors" subtitle="Brands AI is likely to recommend instead. Add the ones that matter in the project's Settings to track them.">
          <Table minWidth={560} head={<><Th>Brand</Th><Th>Type</Th><Th>Website</Th><Th>Why buyers consider it</Th></>}>
            {profile.competitors.map((c) => (
              <Row key={c.name}>
                <td className={td}>{c.name}</td>
                <td className={td}>{COMPETITOR_TYPE[c.type] ?? c.type}</td>
                <td className={td} style={muted}>{c.domain || "–"}</td>
                <td className={td} style={{ color: "var(--text-secondary)" }}>{c.why}</td>
              </Row>
            ))}
          </Table>
        </Panel>
      ) : null}

      <Panel title="Project notes" subtitle="Client answers, calls and decisions: context that stays with the project">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ action: "add", note })) setNote("");
          }}
        >
          <input id="kb-note-author" aria-label="Your name" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" className="rounded-lg border px-2 py-1 text-xs sm:w-36" style={inputStyle} />
          <input id="kb-note" aria-label="New note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Kickoff: main rival in deals is Globex" className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs" style={inputStyle} />
          <button type="submit" disabled={!note.trim()} className="rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50" style={buttonStyle}>Add note</button>
        </form>
        {kb.notes.length ? (
          <ul className="flex flex-col gap-2">
            {[...kb.notes].reverse().map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 border-b pb-2 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
                <div>
                  <p style={{ color: "var(--text-primary)" }}>{n.note}</p>
                  <p style={muted}>{fmtWhen(n.at)}{n.author ? ` · ${n.author}` : ""}</p>
                </div>
                <button type="button" onClick={() => void post({ action: "delete", id: n.id })} className="shrink-0 text-xs underline" style={muted} aria-label="Delete note">Delete</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs" style={muted}>No notes yet.</p>
        )}
      </Panel>
    </div>
  );
}

function commonQueriesOf(kb: KnowledgeBase) {
  const seen = new Set<string>();
  const out: Array<{ query: string; source: string; seed: string }> = [];
  for (const p of [...(kb.serp?.brand ?? []), ...(kb.serp?.demand ?? [])]) {
    for (const [source, items] of [["People also ask", p.questions], ["Related searches", p.related], ["Autocomplete", p.suggestions]] as const) {
      for (const q of items) {
        const key = q.toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ query: q, source, seed: p.query });
      }
    }
  }
  return out;
}
