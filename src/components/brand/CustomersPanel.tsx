"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AspectSummary, CustomerVoice, ListingRef } from "@/lib/brand/customers";
import type { CustomerGap, GapStatus, GapTone } from "@/lib/brand/types";
import { EmptyState, Headline, Panel, SelectControl, Switch } from "@/components/tracking/ui";

export interface CustomersPayload {
  voice: CustomerVoice;
  gap: CustomerGap | null;
  refreshReviews: boolean;
}

/** Loads the brand's customer reviews summary for a date range ("365" = last 12 months). */
export function useCustomers(projectId: string, range: string) {
  const [data, setData] = useState<CustomersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/brand/customers?project=${encodeURIComponent(projectId)}&range=${range}`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as CustomersPayload & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Couldn't load customer reviews");
      return;
    }
    setError(null);
    setData(body);
  }, [projectId, range]);
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
  return { data, error, reload: load, setData };
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const reviewsHref = (projectId: string) => `/google-maps-reviews?project=${encodeURIComponent(projectId)}`;

const STATUS_STYLE: Record<GapStatus, { label: string; color: string; mark: string; hint: string }> = {
  aligned: { label: "Aligned", color: "var(--status-good)", mark: "✓", hint: "AI answers match what customers say" },
  missing: { label: "AI misses it", color: "var(--status-warning)", mark: "!", hint: "Customers talk about it, AI answers don't" },
  contradicts: { label: "Contradicts", color: "var(--status-critical)", mark: "×", hint: "AI answers and customers disagree" },
  "ai-only": { label: "AI only", color: "var(--text-muted)", mark: "?", hint: "AI answers say it, customers don't raise it" },
};

const TONE_LABEL: Record<GapTone, string> = { positive: "Positive", negative: "Negative", mixed: "Mixed", none: "Not mentioned" };
const TONE_COLOR: Record<GapTone, string> = {
  positive: "var(--sentiment-positive)",
  negative: "var(--sentiment-negative)",
  mixed: "var(--sentiment-mixed)",
  none: "var(--gridline)",
};

function Tone({ tone }: { tone: GapTone }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" style={{ color: tone === "none" ? "var(--text-muted)" : "var(--text-secondary)" }}>
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: TONE_COLOR[tone] }} />
      {TONE_LABEL[tone]}
    </span>
  );
}

function StatusChip({ status }: { status: GapStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{ borderColor: `color-mix(in srgb, ${s.color} 45%, transparent)`, color: "var(--text-primary)", background: `color-mix(in srgb, ${s.color} 10%, transparent)` }}
      title={s.hint}
    >
      <span aria-hidden style={{ color: s.color }}>
        {s.mark}
      </span>
      {s.label}
    </span>
  );
}

/** Two scores on one 0-100 axis: how AI answers talk about the brand vs how its customers do. */
function ScoreCompare({ ai, customers }: { ai: number | null; customers: number | null }) {
  const rows = [
    { label: "AI answers", value: ai, color: "var(--series-1)" },
    { label: "Customer reviews", value: customers, color: "var(--series-2)" },
  ];
  const gap = ai !== null && customers !== null ? Math.round(ai - customers) : null;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {r.label}
            </span>
            <span className="tabular text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {r.value === null ? "–" : Math.round(r.value)}
              <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                /100
              </span>
            </span>
          </div>
          <div className="h-2.5 rounded" style={{ background: "var(--meter-track)" }}>
            <div className="h-2.5 rounded" style={{ width: `${r.value ?? 0}%`, background: r.color }} />
          </div>
        </div>
      ))}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {gap === null
          ? "Both scores use the same scale: 100 = all positive, 50 = neutral, 0 = all negative."
          : Math.abs(gap) < 5
            ? "AI answers are about as positive as customers are."
            : gap > 0
              ? `AI answers are ${gap} points more positive than customers - check the contradictions below.`
              : `Customers are ${-gap} points more positive than AI answers - there's credit AI isn't giving you yet.`}
      </p>
    </div>
  );
}

function SourceRatings({ voice }: { voice: CustomerVoice }) {
  return (
    <div className="flex flex-col gap-2">
      {voice.bySource.map((s) => (
        <div key={s.source} className="flex flex-col text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {s.label}
            </span>
            <span className="tabular whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
              {s.publicRating ? (
                <>
                  {s.publicRating.toFixed(1)} <span style={{ color: "var(--rating-star)" }}>★</span>
                </>
              ) : (
                "–"
              )}
              {s.publicCount ? ` · ${s.publicCount.toLocaleString()} reviews` : ""}
            </span>
          </div>
          {s.ranking ? <span style={{ color: "var(--text-muted)" }}>{s.ranking}</span> : null}
        </div>
      ))}
    </div>
  );
}

function GapTable({ gap }: { gap: CustomerGap }) {
  const order: GapStatus[] = ["contradicts", "missing", "ai-only", "aligned"];
  const items = [...gap.items].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <div className="flex flex-col gap-3">
      {gap.summary ? (
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {gap.summary}
        </p>
      ) : null}
      {/* Phones: one card per topic; wider screens: a table. */}
      <ul className="flex flex-col md:hidden">
        {items.map((item, i) => (
          <li key={`${i}-${item.topic}`} className="flex flex-col gap-1 border-t py-2.5" style={{ borderColor: "var(--gridline)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {item.topic}
              </span>
              <StatusChip status={item.status} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="flex items-center gap-1.5">
                Customers <Tone tone={item.customers} />
              </span>
              <span className="flex items-center gap-1.5">
                AI <Tone tone={item.ai} />
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {item.note}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1.5 pr-2 text-left font-medium">Topic</th>
              <th className="py-1.5 pr-2 text-left font-medium">Customers</th>
              <th className="py-1.5 pr-2 text-left font-medium">AI answers</th>
              <th className="py-1.5 pr-2 text-left font-medium">Status</th>
              <th className="py-1.5 text-left font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={`${i}-${item.topic}`} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-2 pr-2 font-medium" style={{ color: "var(--text-primary)" }}>
                  {item.topic}
                </td>
                <td className="py-2 pr-2">
                  <Tone tone={item.customers} />
                </td>
                <td className="py-2 pr-2">
                  <Tone tone={item.ai} />
                </td>
                <td className="py-2 pr-2">
                  <StatusChip status={item.status} />
                </td>
                <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                  {item.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Dashboard card: AI perception vs the customer experience, topic by topic. */
export function AiVsCustomersCard({
  projectId,
  aiScore,
  hasRuns,
  onOpenSection,
}: {
  projectId: string;
  aiScore: number | null;
  hasRuns: boolean;
  onOpenSection: () => void;
}) {
  const { data, error, setData } = useCustomers(projectId, "365");
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  async function compare() {
    setComparing(true);
    setCompareError(null);
    try {
      const res = await fetch("/api/brand/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId }) });
      const body = (await res.json().catch(() => ({}))) as { gap?: CustomerGap; error?: string };
      if (!res.ok || !body.gap) throw new Error(body.error ?? "Comparison failed");
      setData((d) => (d ? { ...d, gap: body.gap ?? null } : d));
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setComparing(false);
    }
  }

  if (error) {
    return (
      <p className="text-xs" style={{ color: "var(--status-critical)" }}>
        {error}
      </p>
    );
  }
  if (!data) return null;
  const v = data.voice;
  const linked = v.listings.filter((l) => l.linked);

  return (
    <Panel
      title="AI answers vs. real customers"
      subtitle="what AI says about the brand next to what customers say in Google Maps and Tripadvisor reviews (last 12 months)"
      actions={
        <button type="button" onClick={onOpenSection} className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
          Customer reviews
        </button>
      }
      footer={
        data.gap ? (
          <>
            <span>
              Compared {fmtDate(data.gap.generatedAt)} · {data.gap.reviews.toLocaleString()} reviews
            </span>
            <button type="button" onClick={() => void compare()} disabled={comparing} className="font-medium hover:underline disabled:opacity-50" style={{ color: "var(--series-1)" }}>
              {comparing ? "Comparing..." : "Compare again"}
            </button>
          </>
        ) : undefined
      }
    >
      {linked.length === 0 ? (
        <EmptyState
          title="Link the brand's review listings"
          body={
            v.listings.length
              ? "None of this project's review listings matches the brand name. Pick the brand's Google Maps and Tripadvisor listings under Customer reviews."
              : "Add the brand's Google Maps and Tripadvisor listings in the Reviews tab - their reviews then appear here next to the AI answers."
          }
          action={
            v.listings.length ? (
              <button type="button" onClick={onOpenSection} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--series-1)" }}>
                Choose listings
              </button>
            ) : (
              <Link href={reviewsHref(projectId)} className="mt-2 inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--series-1)" }}>
                Add listings in Reviews
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <ScoreCompare ai={aiScore} customers={v.totals.score} />
            <SourceRatings voice={v} />
          </div>
          {data.gap ? (
            <GapTable gap={data.gap} />
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {v.totals.analysed === 0
                  ? "The linked listings have no analysed reviews yet - fetch them in the Reviews tab."
                  : hasRuns
                    ? "Compare the latest AI answers with these reviews, topic by topic: what AI gets right, what it misses, and where it contradicts customers."
                    : "Run a brand check first; the comparison is made automatically after each run."}
              </p>
              {v.totals.analysed > 0 && hasRuns ? (
                <button type="button" onClick={() => void compare()} disabled={comparing} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" style={{ background: "var(--series-1)" }}>
                  {comparing ? "Comparing..." : "Compare now"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
      {compareError ? (
        <p className="text-xs" role="alert" style={{ color: "var(--status-critical)" }}>
          {compareError}
        </p>
      ) : null}
    </Panel>
  );
}

function AspectList({ rows, sentiment }: { rows: AspectSummary[]; sentiment: "positive" | "negative" }) {
  const color = sentiment === "positive" ? "var(--sentiment-positive)" : "var(--sentiment-negative)";
  const max = Math.max(1, ...rows.map((r) => r.share));
  if (!rows.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Nothing {sentiment === "positive" ? "praised" : "criticised"} in this period.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.aspect} className="flex flex-col gap-1">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-2">
            <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {r.aspect}
            </span>
            <span className="h-2 rounded" style={{ background: "var(--page-plane)" }}>
              <span className="block h-2 rounded" style={{ width: `${(r.share / max) * 100}%`, background: color }} />
            </span>
            <span className="text-right text-xs tabular" style={{ color: "var(--text-secondary)" }} title={`${r.count} reviews`}>
              {r.share}%
            </span>
          </div>
          {r.quotes.slice(0, 2).map((q) => (
            <p key={q} className="truncate pl-2 text-xs italic" style={{ color: "var(--text-muted)", borderLeft: `2px solid ${color}` }} title={q}>
              &ldquo;{q}&rdquo;
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

const ROLE_LABEL: Record<ListingRef["role"], string> = { brand: "Brand", competitor: "Competitor", other: "Other" };

function ListingsPanel({
  projectId,
  voice,
  refreshReviews,
  onSaveSettings,
}: {
  projectId: string;
  voice: CustomerVoice;
  refreshReviews: boolean;
  onSaveSettings: (patch: { reviewListings?: string[] | null; refreshReviews?: boolean }) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const toggle = async (id: string, on: boolean) => {
    const current = voice.listings.filter((l) => l.linked).map((l) => l.id);
    const next = on ? [...current, id] : current.filter((x) => x !== id);
    setSaving(true);
    try {
      await onSaveSettings({ reviewListings: next });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Panel
      title="The brand's review listings"
      subtitle={voice.auto ? "matched by brand name" : "chosen by you"}
      actions={
        <Link href={reviewsHref(projectId)} className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
          + Add a listing in Reviews
        </Link>
      }
    >
      {voice.listings.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          This project has no review listings yet. Add the brand&apos;s Google Maps and Tripadvisor listings in the Reviews tab (competitors too, to compare
          ratings).
        </p>
      ) : (
        <ul className="flex flex-col">
          <li className="pb-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Ticked listings count as the brand&apos;s own reviews.
          </li>
          {voice.listings.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2" style={{ borderColor: "var(--gridline)" }}>
              <input
                type="checkbox"
                checked={l.linked}
                disabled={saving}
                onChange={(e) => void toggle(l.id, e.target.checked)}
                aria-label={`Count ${l.name} (${l.sourceLabel}) as the brand's own`}
              />
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-primary)" }}>
                {l.name}
              </span>
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
                {l.sourceLabel}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {ROLE_LABEL[l.role]}
              </span>
              <span className="tabular text-xs" style={{ color: "var(--text-secondary)" }}>
                {l.rating ? `${l.rating.toFixed(1)} ★` : "–"} · {l.stored.toLocaleString()} saved
                {l.lastSyncedAt ? ` · updated ${fmtDate(l.lastSyncedAt)}` : " · not fetched yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--gridline)" }}>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Check the brand&apos;s listings for new reviews every week (about 1-3 SerpApi searches per listing)
        </span>
        <Switch checked={refreshReviews} onChange={(v) => void onSaveSettings({ refreshReviews: v })} label="Weekly review refresh" />
      </div>
      {!voice.auto ? (
        <button type="button" onClick={() => void onSaveSettings({ reviewListings: null })} className="self-start text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
          Match by brand name again
        </button>
      ) : null}
    </Panel>
  );
}

/** Section: everything customers say in the brand's Google Maps, Tripadvisor and Google Hotels reviews. */
export function CustomersSection({ projectId, brandName }: { projectId: string; brandName: string }) {
  const [range, setRange] = useState<"90" | "180" | "365" | "all">("365");
  const { data, error, reload } = useCustomers(projectId, range);

  async function saveSettings(patch: { reviewListings?: string[] | null; refreshReviews?: boolean }) {
    await fetch("/api/brand/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId, ...patch }) });
    await reload();
  }

  if (error) {
    return (
      <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading customer reviews...
      </p>
    );
  }
  const v = data.voice;
  const t = v.totals;
  const share = (n: number) => (t.analysed ? `${Math.round((n / t.analysed) * 100)}%` : "–");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectControl
          ariaLabel="Review period"
          value={range}
          onChange={setRange}
          options={[
            { value: "90", label: "Last 90 days" },
            { value: "180", label: "Last 6 months" },
            { value: "365", label: "Last 12 months" },
            { value: "all", label: "All saved reviews" },
          ]}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Reviews of {brandName} from its linked listings{v.lastSyncedAt ? ` · last fetched ${fmtDate(v.lastSyncedAt)}` : ""}
        </span>
      </div>

      {t.reviews > 0 ? (
        <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border p-4 md:grid-cols-6" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }} aria-label="Customer review headline numbers">
          <Headline label="Reviews" value={t.reviews.toLocaleString()} />
          <Headline label="Average rating" value={t.avgRating === null ? "–" : t.avgRating.toFixed(2)} />
          <Headline label="Customer score" value={t.score === null ? "–" : `${Math.round(t.score)}/100`} />
          <Headline label="Positive" value={share(t.sentiment.positive)} />
          <Headline label="Negative" value={share(t.sentiment.negative)} />
          <Headline label="Owner replies" value={t.responseRate === null ? "–" : `${Math.round(t.responseRate)}%`} />
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ListingsPanel projectId={projectId} voice={v} refreshReviews={data.refreshReviews} onSaveSettings={saveSettings} />
        {v.bySource.length ? (
          <Panel title="By review site" subtitle="this period, plus each site's own all-time rating">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr style={{ color: "var(--text-muted)" }}>
                    <th className="py-1 text-left font-medium">Site</th>
                    <th className="py-1 text-right font-medium">Reviews</th>
                    <th className="py-1 text-right font-medium">Avg rating</th>
                    <th className="py-1 text-right font-medium">Positive</th>
                    <th className="py-1 text-right font-medium">Negative</th>
                    <th className="py-1 text-right font-medium">On the site</th>
                  </tr>
                </thead>
                <tbody>
                  {v.bySource.map((s) => (
                    <tr key={s.source} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                      <td className="py-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
                        {s.label}
                        {s.ranking ? (
                          <span className="block text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>
                            {s.ranking}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {s.reviews.toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {s.avgRating?.toFixed(2) ?? "–"}
                      </td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {s.positiveShare === null ? "–" : `${Math.round(s.positiveShare)}%`}
                      </td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {s.negativeShare === null ? "–" : `${Math.round(s.negativeShare)}%`}
                      </td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {s.publicRating ? `${s.publicRating.toFixed(1)} ★` : "–"}
                        {s.publicCount ? ` (${s.publicCount.toLocaleString()})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}
      </div>

      {t.analysed > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="What customers praise" subtitle="share of analysed reviews making each point">
            <AspectList rows={v.praise} sentiment="positive" />
          </Panel>
          <Panel title="What customers criticise" subtitle="share of analysed reviews making each point">
            <AspectList rows={v.criticism} sentiment="negative" />
          </Panel>
        </div>
      ) : v.listings.some((l) => l.linked) ? (
        <EmptyState title="No analysed reviews in this period" body="Pick a longer period, or fetch the listings' reviews in the Reviews tab." />
      ) : null}

      {v.tripadvisor || v.tripTypes.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {v.tripadvisor ? (
            <Panel
              title="On Tripadvisor"
              subtitle={v.tripadvisor.name}
              actions={
                v.tripadvisor.link ? (
                  <a href={v.tripadvisor.link} target="_blank" rel="noreferrer" className="text-xs font-medium hover:underline" style={{ color: "var(--series-1)" }}>
                    Open listing
                  </a>
                ) : undefined
              }
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="tabular text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
                  {v.tripadvisor.rating?.toFixed(1) ?? "–"}
                  <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                    {" "}
                    of 5 · {v.tripadvisor.reviews?.toLocaleString() ?? "?"} reviews
                  </span>
                </span>
                {v.tripadvisor.ranking ? (
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {v.tripadvisor.ranking}
                  </span>
                ) : null}
                {v.tripadvisor.award ? (
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: "color-mix(in srgb, var(--sentiment-positive) 14%, transparent)", color: "var(--text-primary)" }}>
                    {v.tripadvisor.award.type}
                    {v.tripadvisor.award.year ? ` ${v.tripadvisor.award.year}` : ""}
                  </span>
                ) : null}
              </div>
              {v.tripadvisor.subratings.length ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                  {v.tripadvisor.subratings.map((s) => (
                    <div key={s.category} className="flex items-baseline justify-between gap-2 text-xs">
                      <span style={{ color: "var(--text-secondary)" }}>{s.category}</span>
                      <span className="tabular font-semibold" style={{ color: "var(--text-primary)" }}>
                        {s.score.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {v.tripadvisor.summary ? (
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {v.tripadvisor.summary}
                </p>
              ) : null}
              {v.tripadvisor.highlights.length ? (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {v.tripadvisor.highlights.map((h) => (
                    <li key={`${h.category}-${h.value ?? ""}`} className="flex flex-col gap-0.5 rounded-lg border p-2" style={{ borderColor: "var(--border-hairline)" }}>
                      <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                        {h.category}
                        {h.value ? <span style={{ color: "var(--text-muted)" }}> · {h.value}</span> : null}
                      </span>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {h.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ) : null}
          {v.tripTypes.length ? (
            <Panel title="Who it suits" subtitle="reviews by trip type (Tripadvisor), this period">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--text-muted)" }}>
                    <th className="py-1 text-left font-medium">Trip type</th>
                    <th className="py-1 text-right font-medium">Reviews</th>
                    <th className="py-1 text-right font-medium">Avg rating</th>
                    <th className="py-1 text-right font-medium">Positive</th>
                  </tr>
                </thead>
                <tbody>
                  {v.tripTypes.map((tt) => (
                    <tr key={tt.type} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                      <td className="py-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
                        {tt.type}
                      </td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {tt.count}
                      </td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {tt.avgRating?.toFixed(2) ?? "–"}
                      </td>
                      <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {tt.positiveShare === null ? "–" : `${Math.round(tt.positiveShare)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {v.competitors.length ? (
        <Panel title="Competitor ratings" subtitle="competitor listings saved in this project's Reviews tab">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-xs">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="py-1 text-left font-medium">Listing</th>
                  <th className="py-1 text-left font-medium">Site</th>
                  <th className="py-1 text-right font-medium">Rating</th>
                  <th className="py-1 text-right font-medium">Reviews</th>
                  <th className="py-1 text-right font-medium">Ranking</th>
                </tr>
              </thead>
              <tbody>
                {v.competitors.map((c) => (
                  <tr key={`${c.name}-${c.source}`} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                    <td className="py-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
                      {c.name}
                    </td>
                    <td className="py-1.5" style={{ color: "var(--text-secondary)" }}>
                      {c.sourceLabel}
                    </td>
                    <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                      {c.rating ? `${c.rating.toFixed(1)} ★` : "–"}
                    </td>
                    <td className="py-1.5 text-right tabular" style={{ color: "var(--text-primary)" }}>
                      {c.reviewCount?.toLocaleString() ?? "–"}
                    </td>
                    <td className="py-1.5 text-right" style={{ color: "var(--text-secondary)" }}>
                      {c.ranking ?? "–"}
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
