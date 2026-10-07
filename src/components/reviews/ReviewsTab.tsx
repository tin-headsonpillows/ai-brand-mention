"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaceDoc, PlaceSummary, SyncEvent } from "@/lib/reviews/types";
import { EmptyState, SelectControl } from "@/components/tracking/ui";
import { AddBusinessDialog } from "./AddBusinessDialog";
import { ReviewsDashboard } from "./ReviewsDashboard";

const STORAGE_KEY = "reviews.place";
/** Each sync request is time-boxed server-side; this bounds how many the client chains for one run. */
const MAX_SYNC_ROUNDS = 25;

interface SyncState {
  running: boolean;
  message: string | null;
  fetched: number;
  analyzed: number;
  pending: number;
  oldest: string | null;
  error: string | null;
}

const idleSync: SyncState = { running: false, message: null, fetched: 0, analyzed: 0, pending: 0, oldest: null, error: null };

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode etc. - only a convenience
  }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ReviewsTab() {
  const [places, setPlaces] = useState<PlaceSummary[] | null>(null);
  const [mock, setMock] = useState<{ reviews: boolean; analysis: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<PlaceDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sync, setSync] = useState<SyncState>(idleSync);
  const abortRef = useRef<AbortController | null>(null);

  const loadPlaces = useCallback(async () => {
    const res = await fetch("/api/reviews/places", { cache: "no-store" });
    const data = (await res.json()) as { places: PlaceSummary[]; mock: { reviews: boolean; analysis: boolean } };
    setPlaces(data.places);
    setMock(data.mock);
    return data.places;
  }, []);

  const loadDoc = useCallback(async (id: string) => {
    const res = await fetch(`/api/reviews/place?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as PlaceDoc;
    setDoc(data);
    return data;
  }, []);

  useEffect(() => {
    async function init() {
      const list = await loadPlaces();
      const stored = readStored();
      const initial = list.find((p) => p.id === stored)?.id ?? list[0]?.id ?? null;
      setSelectedId(initial);
    }
    void init();
  }, [loadPlaces]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    async function load(id: string) {
      setLoadingDoc(true);
      setDoc(null);
      await loadDoc(id);
      if (!cancelled) setLoadingDoc(false);
    }
    void load(selectedId);
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadDoc]);

  const runSync = useCallback(
    async (id: string, refresh: boolean) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setSync({ ...idleSync, running: true, message: refresh ? "Checking for new reviews..." : "Starting..." });
      let firstRound = true;
      try {
        for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
          const res = await fetch(`/api/reviews/sync?id=${encodeURIComponent(id)}${refresh && firstRound ? "&refresh=1" : ""}`, {
            method: "POST",
            signal: controller.signal,
          });
          firstRound = false;
          if (!res.ok || !res.body) throw new Error(`Sync failed (${res.status})`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let done: Extract<SyncEvent, { type: "done" }> | null = null;
          const apply = (event: SyncEvent) => {
            if (event.type === "status") setSync((s) => ({ ...s, message: event.message }));
            else if (event.type === "progress") setSync((s) => ({ ...s, fetched: event.fetched, analyzed: event.analyzed, pending: event.pending, oldest: event.oldest }));
            else if (event.type === "error") setSync((s) => ({ ...s, error: event.message }));
            else if (event.type === "done") done = event;
          };
          while (true) {
            const { done: finished, value } = await reader.read();
            if (finished) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) if (line.trim()) apply(JSON.parse(line) as SyncEvent);
          }
          if (buffer.trim()) apply(JSON.parse(buffer) as SyncEvent);
          await loadDoc(id);
          const result = done as Extract<SyncEvent, { type: "done" }> | null;
          if (!result || result.complete || (result.fetched === 0 && result.analyzed === 0)) break;
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSync((s) => ({ ...s, error: err instanceof Error ? err.message : "Sync failed" }));
      } finally {
        setSync((s) => ({ ...s, running: false, message: null }));
        void loadPlaces();
      }
    },
    [loadDoc, loadPlaces]
  );

  async function removePlace() {
    if (!doc || !window.confirm(`Remove ${doc.place.name} and its stored reviews?`)) return;
    await fetch(`/api/reviews/places?id=${encodeURIComponent(doc.id)}`, { method: "DELETE" });
    const list = await loadPlaces();
    setDoc(null);
    setSelectedId(list[0]?.id ?? null);
  }

  const incomplete = doc ? doc.fetch.phase !== "done" || doc.reviews.some((r) => !r.analysis) : false;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Reviews
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Pull a business&apos;s Google reviews, see how sentiment moves over time, and find exactly what customers praise
            and criticise.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {places && places.length > 0 && selectedId ? (
            <SelectControl
              value={selectedId}
              options={places.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => {
                setSelectedId(id);
                store(id);
              }}
              ariaLabel="Business"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
            style={{ background: "var(--series-1)" }}
          >
            + Add business
          </button>
        </div>
      </header>

      {mock && (mock.reviews || mock.analysis) ? (
        <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--status-warning)", color: "var(--text-secondary)" }}>
          {mock.reviews ? "No SerpApi key is configured on the server - reviews are simulated. " : ""}
          {mock.analysis ? "No OpenAI key is configured - sentiment uses a simple keyword method instead of the model." : ""}
        </p>
      ) : null}

      {places === null ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading...
        </p>
      ) : places.length === 0 ? (
        <EmptyState
          title="No businesses yet"
          body="Add a business from Google Maps (or a hotel from Google Hotels) to fetch its reviews and analyse sentiment."
          action={
            <button type="button" onClick={() => setAdding(true)} className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--series-1)" }}>
              + Add business
            </button>
          }
        />
      ) : (
        <>
          {doc ? (
            <section
              className="flex flex-wrap items-center gap-4 rounded-xl border p-4"
              style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
            >
              {doc.place.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- Google-hosted thumbnail
                <img src={doc.place.thumbnail} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                    {doc.place.name}
                  </span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
                    {doc.place.source === "maps" ? "Google Maps" : "Google Hotels"}
                  </span>
                </span>
                <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                  {[doc.place.type, doc.place.address].filter(Boolean).join(" · ")}
                </span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {doc.place.rating ? `${doc.place.rating.toFixed(1)} ★ on Google` : ""}
                  {doc.place.reviewCount ? ` · ${doc.place.reviewCount.toLocaleString()} reviews in total` : ""}
                  {` · ${doc.reviews.length.toLocaleString()} fetched (last ${doc.settings.monthsBack} months, cap ${doc.settings.maxReviews.toLocaleString()})`}
                  {doc.lastSyncedAt ? ` · updated ${fmtDate(doc.lastSyncedAt)}` : ""}
                  {` · ${doc.searchesUsed} SerpApi searches used`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {sync.running ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                    style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void runSync(doc.id, !incomplete)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                    style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}
                    title={incomplete ? "Continue fetching and analysing" : "Fetch reviews posted since the last update"}
                  >
                    {incomplete ? "Resume" : "Refresh"}
                  </button>
                )}
                <button type="button" onClick={() => void removePlace()} disabled={sync.running} className="rounded-lg px-2 py-1.5 text-xs disabled:opacity-50" style={{ color: "var(--text-muted)" }}>
                  Remove
                </button>
              </div>
            </section>
          ) : null}

          {sync.running || sync.error ? (
            <section className="flex flex-col gap-2 rounded-xl border p-4" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
              {sync.running ? (
                <>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {sync.message ?? "Working..."}
                  </p>
                  <p className="text-xs tabular" style={{ color: "var(--text-muted)" }}>
                    {sync.fetched.toLocaleString()} reviews fetched{sync.oldest ? ` (back to ${fmtDate(sync.oldest)})` : ""} ·{" "}
                    {sync.analyzed.toLocaleString()} analysed
                  </p>
                  <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--meter-track)" }}>
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${sync.fetched ? Math.round((sync.analyzed / sync.fetched) * 100) : 4}%`, background: "var(--series-1)" }}
                    />
                  </div>
                </>
              ) : null}
              {sync.error ? (
                <p className="text-sm" style={{ color: "var(--status-critical)" }}>
                  {sync.error}
                </p>
              ) : null}
            </section>
          ) : null}

          {loadingDoc && !doc ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading reviews...
            </p>
          ) : doc && doc.reviews.length > 0 ? (
            <ReviewsDashboard doc={doc} />
          ) : doc && !sync.running ? (
            <EmptyState
              title="No reviews fetched yet"
              body="Fetch this business's reviews to see the analysis."
              action={
                <button type="button" onClick={() => void runSync(doc.id, false)} className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--series-1)" }}>
                  Fetch reviews
                </button>
              }
            />
          ) : null}
        </>
      )}

      {adding ? (
        <AddBusinessDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            store(id);
            void (async () => {
              await loadPlaces();
              setSelectedId(id);
              await runSync(id, false);
            })();
          }}
        />
      ) : null}
    </div>
  );
}
