"use client";

import { useState } from "react";
import type { PlaceRef, ReviewSource } from "@/lib/reviews/types";
import { Segmented, SelectControl } from "@/components/tracking/ui";

export const HISTORY_OPTIONS = [
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "24", label: "Last 24 months" },
  { value: "0", label: "All history" },
];
export const CAP_OPTIONS = [
  { value: "200", label: "Up to 200 reviews" },
  { value: "500", label: "Up to 500 reviews" },
  { value: "1000", label: "Up to 1,000 reviews" },
  { value: "2000", label: "Up to 2,000 reviews" },
  { value: "5000", label: "Up to 5,000 reviews" },
];

/** Google Maps pages hold 8 reviews first, then 20; Google Hotels pages are smaller, so this is an upper bound there. */
function searchEstimate(source: ReviewSource, cap: number): string {
  return source === "maps" ? `Up to ${1 + Math.ceil(Math.max(0, cap - 8) / 20)}` : `Up to ${Math.ceil(cap / 10)}`;
}

export function AddBusinessDialog({
  projectId,
  onClose,
  onAdded,
}: {
  projectId: string;
  onClose: () => void;
  onAdded: (id: string, reused: boolean) => void;
}) {
  const [source, setSource] = useState<ReviewSource>("maps");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<PlaceRef[] | null>(null);
  const [picked, setPicked] = useState<PlaceRef | null>(null);
  const [monthsBack, setMonthsBack] = useState("12");
  const [maxReviews, setMaxReviews] = useState("1000");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setPicked(null);
    try {
      const res = await fetch(`/api/reviews/search?${new URLSearchParams({ q: query.trim(), source })}`);
      const data = (await res.json()) as { candidates?: PlaceRef[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setCandidates(data.candidates ?? []);
      if (data.candidates?.length === 1) setPicked(data.candidates[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setCandidates(null);
    } finally {
      setSearching(false);
    }
  }

  async function add() {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: picked, monthsBack: Number(monthsBack), maxReviews: Number(maxReviews), project: projectId }),
      });
      const data = (await res.json()) as { id?: string; reused?: boolean; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not add this business");
      onAdded(data.id, Boolean(data.reused));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this business");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label="Add a business">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border p-5 shadow-xl" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Add a business
            </h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Find it on Google, choose how much review history to pull, and we&apos;ll fetch and analyse every review.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: "var(--text-muted)" }} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <Segmented
            value={source}
            options={[
              { value: "maps", label: "Google Maps reviews", title: "Any business on Google Maps" },
              { value: "hotels", label: "Google Hotels reviews", title: "Hotels - includes partner review sites" },
            ]}
            onChange={(v) => {
              setSource(v);
              setCandidates(null);
              setPicked(null);
            }}
            ariaLabel="Review source"
          />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {source === "maps"
              ? "Works for any business. Exact review dates. Paste a Google Maps link or search by name and city."
              : "For hotels: Google reviews plus partner sites such as Tripadvisor. Google only shows relative dates here (\"2 weeks ago\")."}
          </span>
        </div>

        <form onSubmit={search} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={source === "maps" ? "e.g. Furama Resort Da Nang, or a Google Maps link" : "e.g. InterContinental Danang Sun Peninsula"}
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" }}
            autoFocus
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--series-1)" }}
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </form>

        {candidates ? (
          candidates.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No matches - try adding the city, or switch the review source.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {candidates.map((c, i) => {
                const active = picked === c;
                return (
                  <li key={`${c.name}-${i}`}>
                    <button
                      type="button"
                      onClick={() => setPicked(c)}
                      className="flex w-full items-center gap-3 rounded-lg border p-2 text-left"
                      style={{
                        borderColor: active ? "var(--series-1)" : "var(--border-hairline)",
                        background: active ? "color-mix(in srgb, var(--series-1) 8%, transparent)" : "transparent",
                      }}
                    >
                      {c.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Google-hosted thumbnail
                        <img src={c.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="h-12 w-12 shrink-0 rounded" style={{ background: "var(--page-plane)" }} />
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {c.name}
                        </span>
                        <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                          {[c.rating ? `${c.rating.toFixed(1)} ★` : null, c.reviewCount ? `${c.reviewCount.toLocaleString()} reviews` : null, c.type, c.address]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <SelectControl value={monthsBack} options={HISTORY_OPTIONS} onChange={setMonthsBack} ariaLabel="History to fetch" />
          <SelectControl value={maxReviews} options={CAP_OPTIONS} onChange={setMaxReviews} ariaLabel="Review cap" />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {searchEstimate(source, Math.min(Number(maxReviews), picked?.reviewCount ?? Number(maxReviews)))} SerpApi credits (1 per page of
            reviews). Reviews are saved to this project - refreshes only fetch new ones, and adding the same business to another project reuses them.
          </span>
        </div>

        {error ? (
          <p className="text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!picked || saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--series-1)" }}
          >
            {saving ? "Adding..." : "Fetch & analyse reviews"}
          </button>
        </div>
      </div>
    </div>
  );
}
