"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProjectSummary, SerpUsage } from "@/lib/tracking/types";
import { writeParams } from "@/lib/urlState";
import { SerpUsageBadge } from "@/components/SerpUsageBadge";
import { ProjectBar, type NewProjectInput } from "@/components/tracking/ProjectBar";
import { BrandMentionsView } from "./BrandMentionsView";

/** Shared with Google Search Tracking and Reviews, so every tab opens on the same project. */
const PROJECT_STORAGE_KEY = "tracking.project";

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

/** The Brand Mentions dashboard: its own tab, on the same projects (brand, competitors, market) as Search Tracking. */
export function BrandMentionsTab() {
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
      // A bookmarked ?project= wins over the last project used on this device.
      const pick = [urlProject.current, rememberedProject()].find((id) => id && list.some((p) => p.id === id));
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
    rememberProject(body.id);
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
            What Google AI Mode, AI Overview, ChatGPT and Claude say about your brand - and what customers say on Google Maps and Tripadvisor
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
        <BrandMentionsView key={projectId} projectId={projectId} onOpenSettings={openSettings} onRunFinished={loadUsage} />
      ) : null}
    </div>
  );
}
