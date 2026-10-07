"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PlaceDoc, PlaceSummary, SyncEvent } from "@/lib/reviews/types";
import type { ProjectSummary, SerpUsage } from "@/lib/tracking/types";
import { SerpUsageBadge } from "@/components/SerpUsageBadge";
import { writeParams } from "@/lib/urlState";
import { EmptyState, SelectControl } from "@/components/tracking/ui";
import { ProjectBar, type NewProjectInput } from "@/components/tracking/ProjectBar";
import { AddBusinessDialog, CAP_OPTIONS, HISTORY_OPTIONS } from "./AddBusinessDialog";
import { FETCH_VERSION, fetchTarget, looksTruncated, windowCutoff } from "@/lib/reviews/coverage";
import { ReviewsDashboard } from "./ReviewsDashboard";

const STORAGE_KEY = "reviews.place";
/** Shared with Google Search Tracking, so both tabs open on the same project. */
const PROJECT_STORAGE_KEY = "tracking.project";

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

function store(id: string, key = STORAGE_KEY) {
  try {
    localStorage.setItem(key, id);
  } catch {
    // private mode etc. - only a convenience
  }
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * True while there's fetching left to do: a pass in progress, or a place completed by older fetch logic that
 * stopped early (v1) or didn't yet try the other sort orders when Google cut the newest-first list short (v2).
 */
function needsFetch(doc: PlaceDoc): boolean {
  if (doc.fetch.phase !== "done") return true;
  const version = doc.fetch.version ?? 1;
  return version < 2 || (version < FETCH_VERSION && looksTruncated(doc, windowCutoff(doc)));
}

/**
 * Rough SerpApi credits to finish: 1 per page (20 reviews; 8 on the first Google Maps page). Passes in other
 * sort orders re-read reviews already saved, so they're estimated at about twice the pages.
 */
function remainingCredits(doc: PlaceDoc): number {
  if (!needsFetch(doc)) return 0;
  const perPage = doc.place.source === "maps" ? 20 : 10;
  const target = fetchTarget(doc) ?? doc.settings.maxReviews;
  const missingPages = Math.ceil(Math.max(0, target - doc.reviews.length) / perPage);
  const version = doc.fetch.version ?? 1;
  if (doc.fetch.phase === "extra" || (doc.fetch.phase === "done" && version >= 2)) return Math.max(3, missingPages * 2);
  const reread = doc.fetch.nextPageToken ? 0 : Math.ceil(doc.reviews.length / perPage);
  return Math.max(1, reread + missingPages + (doc.fetch.nextPageToken ? 0 : 1));
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ReviewsTab() {
  const searchParams = useSearchParams();
  // A bookmarked ?project= / ?business= opens that exact view; otherwise the last one used on this device.
  const urlProject = useRef(searchParams.get("project"));
  const urlBusiness = useRef(searchParams.get("business"));
  const [usage, setUsage] = useState<SerpUsage | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [places, setPlaces] = useState<PlaceSummary[] | null>(null);
  const [mock, setMock] = useState<{ reviews: boolean; analysis: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<PlaceDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sync, setSync] = useState<SyncState>(idleSync);
  const abortRef = useRef<AbortController | null>(null);

  const loadUsage = useCallback(async () => {
    const res = await fetch("/api/tracking/usage", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setUsage((await res.json()) as SerpUsage);
  }, []);

  const loadPlaces = useCallback(async (project: string) => {
    const res = await fetch(`/api/reviews/places?project=${encodeURIComponent(project)}`, { cache: "no-store" });
    const data = (await res.json()) as { places?: PlaceSummary[]; mock?: { reviews: boolean; analysis: boolean } };
    const list = data.places ?? [];
    setPlaces(list);
    if (data.mock) setMock(data.mock);
    return list;
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
      const res = await fetch("/api/tracking/projects", { cache: "no-store" });
      const list = ((await res.json()) as { projects?: ProjectSummary[] }).projects ?? [];
      setProjects(list);
      const remembered = readKey(PROJECT_STORAGE_KEY);
      const pick = [urlProject.current, remembered].find((id) => id && list.some((p) => p.id === id));
      urlProject.current = null;
      setProjectId(pick ?? list[0]?.id ?? null);
    }
    void init();
    void loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    writeParams({ project: projectId ?? undefined, business: selectedId ?? undefined });
  }, [projectId, selectedId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    async function load(project: string) {
      setPlaces(null);
      setDoc(null);
      setSelectedId(null);
      const list = await loadPlaces(project);
      if (cancelled) return;
      const stored = readStored();
      const pick = [urlBusiness.current, stored].find((id) => id && list.some((p) => p.id === id));
      urlBusiness.current = null;
      setSelectedId(pick ?? list[0]?.id ?? null);
    }
    void load(projectId);
    return () => {
      cancelled = true;
    };
  }, [projectId, loadPlaces]);

  const createProject = useCallback(async (input: NewProjectInput) => {
    const res = await fetch("/api/tracking/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) throw new Error(body.error || `Couldn't create the project (status ${res.status})`);
    const list = ((await (await fetch("/api/tracking/projects", { cache: "no-store" })).json()) as { projects: ProjectSummary[] }).projects;
    setProjects(list);
    store(body.id, PROJECT_STORAGE_KEY);
    setProjectId(body.id);
  }, []);

  async function changeSettings(next: { monthsBack?: number; maxReviews?: number }) {
    if (!doc) return;
    await fetch("/api/reviews/places", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: doc.id, ...next }),
    });
    await loadDoc(doc.id);
  }

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
        if (projectId) void loadPlaces(projectId);
        void loadUsage();
      }
    },
    [loadDoc, loadPlaces, loadUsage, projectId]
  );

  async function removePlace() {
    if (!doc || !projectId) return;
    const shared = (doc.projectIds?.length ?? 1) > 1;
    const message = shared
      ? `Remove ${doc.place.name} from this project? Its reviews stay saved for the other project(s) using it.`
      : `Remove ${doc.place.name} and delete its ${doc.reviews.length} saved reviews? Fetching them again would cost SerpApi credits.`;
    if (!window.confirm(message)) return;
    await fetch(`/api/reviews/places?id=${encodeURIComponent(doc.id)}&project=${encodeURIComponent(projectId)}`, { method: "DELETE" });
    const list = await loadPlaces(projectId);
    setDoc(null);
    setSelectedId(list[0]?.id ?? null);
  }

  const fetchPending = doc ? needsFetch(doc) : false;
  const incomplete = doc ? fetchPending || doc.reviews.some((r) => !r.analysis) : false;
  const credits = doc ? remainingCredits(doc) : 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Google Maps Reviews
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Pull a business&apos;s Google reviews, see how sentiment moves over time, and find exactly what customers praise
            and criticise.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 ? (
            <ProjectBar
              projects={projects}
              activeId={projectId}
              onSelect={(id) => {
                store(id, PROJECT_STORAGE_KEY);
                setProjectId(id);
              }}
              onCreate={createProject}
            />
          ) : null}
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
          <SerpUsageBadge usage={usage} />
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
                  {doc.place.reviewCount ? ` · ${doc.place.reviewCount.toLocaleString()} reviews on Google` : ""}
                  {` · ${doc.reviews.length.toLocaleString()} saved`}
                  {doc.place.reviewCount && doc.settings.monthsBack === 0
                    ? ` (${Math.min(100, Math.round((doc.reviews.length / doc.place.reviewCount) * 100))}%)`
                    : ""}
                  {doc.lastSyncedAt ? ` · updated ${fmtDate(doc.lastSyncedAt)}` : ""}
                  {` · ${doc.searchesUsed} SerpApi credits spent so far`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SelectControl
                  value={String(doc.settings.monthsBack)}
                  options={HISTORY_OPTIONS}
                  onChange={(v) => void changeSettings({ monthsBack: Number(v) })}
                  ariaLabel="History to keep"
                />
                <SelectControl
                  value={String(doc.settings.maxReviews)}
                  options={CAP_OPTIONS}
                  onChange={(v) => void changeSettings({ maxReviews: Number(v) })}
                  ariaLabel="Review cap"
                />
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
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                    style={
                      fetchPending
                        ? { background: "var(--series-1)", color: "#fff" }
                        : { border: "1px solid var(--border-hairline)", color: "var(--text-primary)" }
                    }
                    title={
                      fetchPending
                        ? "Fetch the reviews not saved yet - saved reviews are never fetched twice"
                        : incomplete
                          ? "Finish analysing the saved reviews (no SerpApi credits)"
                          : "Fetch reviews posted since the last update (usually 1 credit)"
                    }
                  >
                    {fetchPending ? `Fetch remaining (~${credits} credits)` : incomplete ? "Finish analysis" : "Refresh"}
                  </button>
                )}
                <button type="button" onClick={() => void removePlace()} disabled={sync.running} className="rounded-lg px-2 py-1.5 text-xs disabled:opacity-50" style={{ color: "var(--text-muted)" }}>
                  Remove
                </button>
              </div>
            </section>
          ) : null}

          {doc && !fetchPending && doc.fetch.version === FETCH_VERSION && looksTruncated(doc, windowCutoff(doc)) ? (
            <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
              Google lists {doc.reviews.length.toLocaleString()} of the {doc.place.reviewCount?.toLocaleString()} reviews it counts for this
              place, across every sort order. The rest can&apos;t be retrieved: Google&apos;s count includes reviews it doesn&apos;t
              list (for example removed or filtered ones).
            </p>
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

      {adding && projectId ? (
        <AddBusinessDialog
          projectId={projectId}
          onClose={() => setAdding(false)}
          onAdded={(id, reused) => {
            setAdding(false);
            store(id);
            void (async () => {
              await loadPlaces(projectId);
              setSelectedId(id);
              // A business already saved under another project brings its reviews along - nothing to fetch.
              if (!reused) await runSync(id, false);
            })();
          }}
        />
      ) : null}
    </div>
  );
}
