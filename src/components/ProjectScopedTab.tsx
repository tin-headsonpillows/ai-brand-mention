"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProjectSummary, SerpUsage } from "@/lib/tracking/types";
import { writeParams } from "@/lib/urlState";
import { SerpUsageBadge } from "@/components/SerpUsageBadge";
import { ProjectBar, type NewProjectInput } from "@/components/tracking/ProjectBar";

/** Shared with every project tab, so they all open on the same project. */
const PROJECT_STORAGE_KEY = "tracking.project";

function remember(id: string) {
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, id);
  } catch {
    // private mode etc. - the project just won't be remembered
  }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Project picker + SerpApi badge around a tab that works on one project (same projects as Search Tracking). */
export function ProjectScopedTab({
  intro,
  children,
}: {
  intro: string;
  children: (ctx: { projectId: string; openSettings: () => void; refreshUsage: () => void }) => ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlProject = useRef(searchParams.get("project"));
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [usage, setUsage] = useState<SerpUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    const res = await fetch("/api/tracking/usage", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setUsage((await res.json()) as SerpUsage);
  }, []);

  useEffect(() => {
    async function init() {
      const res = await fetch("/api/tracking/projects", { cache: "no-store" }).catch(() => null);
      if (!res?.ok) {
        setError(`Failed to load projects${res ? ` (status ${res.status})` : ""}`);
        return;
      }
      const list = ((await res.json()) as { projects?: ProjectSummary[] }).projects ?? [];
      setProjects(list);
      const pick = [urlProject.current, remembered()].find((id) => id && list.some((p) => p.id === id));
      urlProject.current = null;
      setProjectId(pick ?? list[0]?.id ?? null);
      await loadUsage();
    }
    void init();
  }, [loadUsage]);

  useEffect(() => {
    writeParams({ project: projectId ?? undefined });
  }, [projectId]);

  const createProject = useCallback(async (input: NewProjectInput) => {
    const res = await fetch("/api/tracking/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) throw new Error(body.error || `Couldn't create the project (status ${res.status})`);
    const list = ((await (await fetch("/api/tracking/projects", { cache: "no-store" })).json()) as { projects: ProjectSummary[] }).projects;
    setProjects(list);
    remember(body.id);
    setProjectId(body.id);
  }, []);

  const openSettings = useCallback(() => {
    if (projectId) router.push(`/google-search-tracking?project=${encodeURIComponent(projectId)}&view=settings`);
  }, [projectId, router]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {intro}
          </p>
          {projects ? (
            <ProjectBar
              projects={projects}
              activeId={projectId}
              onSelect={(id) => {
                remember(id);
                setProjectId(id);
              }}
              onCreate={createProject}
            />
          ) : null}
        </div>
        <SerpUsageBadge usage={usage} />
      </header>
      {error ? (
        <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      ) : !projects ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading...
        </p>
      ) : projectId ? (
        <div key={projectId}>{children({ projectId, openSettings, refreshUsage: () => void loadUsage() })}</div>
      ) : null}
    </div>
  );
}

/** Ordered steps with a status each, shown while a multi-request job runs. */
export type StepState = "waiting" | "running" | "done" | "error" | "skipped";

export function StepList({ steps }: { steps: Array<{ key: string; label: string; state: StepState; detail?: string }> }) {
  const mark: Record<StepState, { icon: string; color: string }> = {
    waiting: { icon: "○", color: "var(--text-muted)" },
    running: { icon: "◐", color: "var(--series-1)" },
    done: { icon: "✓", color: "var(--success-text)" },
    error: { icon: "✕", color: "var(--status-critical)" },
    skipped: { icon: "–", color: "var(--text-muted)" },
  };
  return (
    <ol className="flex flex-col gap-1 text-xs" aria-live="polite">
      {steps.map((s) => (
        <li key={s.key} className="flex gap-2">
          <span aria-hidden style={{ color: mark[s.state].color }}>
            {mark[s.state].icon}
          </span>
          <span style={{ color: s.state === "waiting" ? "var(--text-muted)" : "var(--text-primary)" }}>{s.label}</span>
          {s.detail ? <span style={{ color: s.state === "error" ? "var(--status-critical)" : "var(--text-muted)" }}>· {s.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export const buttonStyle: React.CSSProperties = { background: "var(--series-1)", color: "#fff" };
export const secondaryButtonStyle: React.CSSProperties = { borderColor: "var(--border-hairline)", color: "var(--text-primary)", background: "var(--surface-1)" };
