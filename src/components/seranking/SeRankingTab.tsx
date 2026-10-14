"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SeSite, SeSnapshot } from "@/lib/seranking/types";
import type { ProjectSummary } from "@/lib/tracking/types";
import { readParam, writeParams } from "@/lib/urlState";
import { EmptyState } from "@/components/tracking/ui";
import { ProjectBar, type NewProjectInput } from "@/components/tracking/ProjectBar";
import { AiSection } from "./AiSection";
import { AuditSection } from "./AuditSection";
import { BacklinksSection } from "./BacklinksSection";
import { CompetitorsSection } from "./CompetitorsSection";
import { OverviewSection } from "./OverviewSection";
import { RankingsSection } from "./RankingsSection";

/** Shared with the other tabs, so every tab opens on the same project. */
const PROJECT_STORAGE_KEY = "tracking.project";
/** SE Ranking re-checks rankings daily; an older snapshot is refreshed when the page opens. */
const STALE_MS = 12 * 3_600_000;

type Section = "overview" | "rankings" | "competitors" | "backlinks" | "audit" | "ai";
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "rankings", label: "Rankings" },
  { id: "competitors", label: "Competitors" },
  { id: "backlinks", label: "Backlinks" },
  { id: "audit", label: "Site audit" },
  { id: "ai", label: "AI prompts" },
];

interface ProjectPayload {
  mock: boolean;
  site: SeSite | null;
  auto: boolean;
  siteError: string | null;
  snapshot: SeSnapshot | null;
}

function rememberProject(id: string) {
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, id);
  } catch {
    // private mode etc. - the project just won't be remembered
  }
}

function rememberedProject(): string | null {
  try {
    return localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function SeRankingTab() {
  const searchParams = useSearchParams();
  const urlProject = useRef(searchParams.get("project"));
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(() => (SECTIONS.some((s) => s.id === readParam("view")) ? (readParam("view") as Section) : "overview"));
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [sites, setSites] = useState<SeSite[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshingLinks, setRefreshingLinks] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const autoSynced = useRef<string | null>(null);

  useEffect(() => {
    async function init() {
      const res = await fetch("/api/tracking/projects", { cache: "no-store" }).catch(() => null);
      const list = res?.ok ? (((await res.json()) as { projects?: ProjectSummary[] }).projects ?? []) : [];
      setProjects(list);
      const pick = [urlProject.current, rememberedProject()].find((id) => id && list.some((p) => p.id === id));
      urlProject.current = null;
      setProjectId(pick ?? list[0]?.id ?? null);
    }
    void init();
  }, []);

  useEffect(() => {
    writeParams({ project: projectId ?? undefined, view: section === "overview" ? null : section });
  }, [projectId, section]);

  const load = useCallback(async (id: string) => {
    const res = await fetch(`/api/seranking/project?project=${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as (ProjectPayload & { error?: string }) | null;
    if (!res.ok || !body) {
      setMessage(body?.error ?? "Couldn't load SE Ranking data");
      return null;
    }
    setData(body);
    return body;
  }, []);

  const sync = useCallback(
    async (id: string) => {
      setSyncing(true);
      setMessage("Syncing from SE Ranking - rankings, competitors, audit, AI prompts... (about a minute)");
      try {
        const res = await fetch(`/api/seranking/sync?project=${encodeURIComponent(id)}`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: Record<string, string> };
        if (!res.ok) throw new Error(body.error ?? `Sync failed (${res.status})`);
        const failed = Object.keys(body.errors ?? {});
        setMessage(failed.length ? `Synced, but SE Ranking didn't return: ${failed.join(", ")}. Details are shown in those sections.` : null);
        await load(id);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Sync failed");
      } finally {
        setSyncing(false);
      }
    },
    [load]
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    async function run(id: string) {
      setData(null);
      setMessage(null);
      const body = await load(id);
      if (cancelled || !body?.site) return;
      const stale = !body.snapshot || Date.now() - Date.parse(body.snapshot.syncedAt) > STALE_MS;
      if (stale && autoSynced.current !== `${id}:${body.site.id}`) {
        autoSynced.current = `${id}:${body.site.id}`;
        await sync(id);
      }
    }
    void run(projectId);
    return () => {
      cancelled = true;
    };
  }, [projectId, load, sync]);

  // The SE Ranking project list (for the link picker) loads once, in the background.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetch("/api/seranking/sites", { cache: "no-store" }).catch(() => null);
      const body = res?.ok ? ((await res.json()) as { sites?: SeSite[] }) : null;
      if (!cancelled) setSites(body?.sites ?? []);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshLinks() {
    if (!projectId) return;
    setRefreshingLinks(true);
    setMessage("Refreshing backlink data from SE Ranking...");
    try {
      const res = await fetch(`/api/seranking/backlinks?project=${encodeURIComponent(projectId)}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string | null; partial?: Record<string, string> };
      if (!res.ok || body.error) throw new Error(body.error ?? `Refresh failed (${res.status})`);
      const missing = Object.keys(body.partial ?? {});
      setMessage(missing.length ? `Backlinks refreshed, but SE Ranking didn't return: ${missing.join(", ")}.` : null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      await load(projectId);
      setRefreshingLinks(false);
    }
  }

  async function changeLink(value: string) {
    if (!projectId) return;
    await fetch("/api/seranking/link", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId, siteId: value === "auto" ? null : Number(value) }) });
    const body = await load(projectId);
    if (body?.site && (!body.snapshot || body.snapshot.siteId !== body.site.id)) await sync(projectId);
  }

  const createProject = useCallback(async (input: NewProjectInput) => {
    const res = await fetch("/api/tracking/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) throw new Error(body.error || `Couldn't create the project (status ${res.status})`);
    const list = ((await (await fetch("/api/tracking/projects", { cache: "no-store" })).json()) as { projects: ProjectSummary[] }).projects;
    setProjects(list);
    rememberProject(body.id);
    setProjectId(body.id);
  }, []);

  const snap = data?.snapshot ?? null;
  const linkValue = data?.auto ? "auto" : String(data?.site?.id ?? "auto");
  const siteOptions = sites ?? (data?.site ? [data.site] : []);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Rank tracking, competitors, backlinks, site audit and AI prompt tracking from your SE Ranking account, synced daily
          </p>
          {projects ? (
            <ProjectBar
              projects={projects}
              activeId={projectId}
              onSelect={(id) => {
                rememberProject(id);
                setProjectId(id);
              }}
              onCreate={createProject}
            />
          ) : null}
        </div>
        {data ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              SE Ranking project
              <select
                value={linkValue}
                onChange={(e) => void changeLink(e.target.value)}
                disabled={syncing}
                className="max-w-[18rem] rounded-lg border px-2 py-1.5 text-xs"
                style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
              >
                <option value="auto">{data.auto && data.site ? `Matched by website: ${data.site.title}` : "Match by website"}</option>
                {siteOptions.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.title === s.url ? s.url : `${s.title} · ${s.url}`} ({s.keywordCount} kw)
                  </option>
                ))}
              </select>
            </label>
            {data.site ? (
              <button
                type="button"
                onClick={() => projectId && void sync(projectId)}
                disabled={syncing}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--series-1)" }}
              >
                {syncing ? "Syncing..." : "Sync now"}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {data?.mock ? (
        <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--status-warning)", color: "var(--text-secondary)" }}>
          No SE Ranking API key is configured on the server - showing generated data.
        </p>
      ) : null}
      {message ? (
        <div className="rounded-lg border px-4 py-2.5 text-sm" role="status" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
          {message}
        </div>
      ) : null}
      {data?.siteError ? (
        <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
          {data.siteError}
        </p>
      ) : null}

      {!projects || (projectId && !data) ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading...
        </p>
      ) : !data?.site ? (
        <EmptyState
          title="No SE Ranking project for this brand"
          body="None of the SE Ranking projects tracks this project's website. Pick the SE Ranking project above, or set the brand's website in Google Search Tracking settings."
        />
      ) : !snap ? (
        <EmptyState title={syncing ? "Syncing from SE Ranking..." : "Not synced yet"} body={`Pulls rankings, the site audit and AI prompt results for ${data.site.title}.`} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="flex flex-wrap gap-1 rounded-lg p-0.5" style={{ background: "var(--page-plane)", border: "1px solid var(--border-hairline)" }} role="tablist" aria-label="SE Ranking sections">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={section === s.id}
                  onClick={() => setSection(s.id)}
                  className="rounded-md px-3 py-1 text-xs font-medium"
                  style={{ background: section === s.id ? "var(--surface-1)" : "transparent", color: section === s.id ? "var(--text-primary)" : "var(--text-muted)", boxShadow: section === s.id ? "0 1px 2px rgba(0,0,0,0.08)" : undefined }}
                >
                  {s.label}
                </button>
              ))}
            </nav>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {snap.siteTitle !== snap.siteUrl ? `${snap.siteTitle} · ` : ""}
              {snap.siteUrl} · synced {fmtTime(snap.syncedAt)}
              {snap.guestLink ? (
                <>
                  {" · "}
                  <a href={snap.guestLink} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--series-1)" }}>
                    open in SE Ranking
                  </a>
                </>
              ) : null}
            </span>
          </div>
          {section === "overview" ? (
            <OverviewSection snap={snap} onOpen={setSection} />
          ) : section === "rankings" ? (
            <RankingsSection snap={snap} />
          ) : section === "audit" ? (
            <AuditSection audit={snap.audit} />
          ) : section === "ai" ? (
            <AiSection ai={snap.ai} visible={snap.visible} errors={snap.errors} />
          ) : section === "backlinks" ? (
            <BacklinksSection snap={snap} onRefresh={() => void refreshLinks()} refreshing={refreshingLinks || syncing} />
          ) : (
            <CompetitorsSection snap={snap} />
          )}
        </>
      )}
    </div>
  );
}
