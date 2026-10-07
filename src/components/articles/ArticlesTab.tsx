"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ArticleSummary, PlanField, SheetPreview } from "@/lib/articles/types";
import type { ProjectSummary } from "@/lib/tracking/types";
import type { WordPressSettingsView } from "@/lib/wordpress/store";
import { writeParams } from "@/lib/urlState";
import { ProjectBar, type NewProjectInput } from "@/components/tracking/ProjectBar";
import { Segmented } from "@/components/tracking/ui";
import { ArticleEditor } from "./ArticleEditor";
import { ArticleList } from "./ArticleList";
import { ArticleSettings } from "./ArticleSettings";
import { ImportDialog, type GoogleStatus } from "./ImportDialog";
import { buttonPrimary, buttonSecondary, secondaryStyle } from "./shared";

type View = "list" | "settings";
const PROJECT_STORAGE_KEY = "tracking.project";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // only a convenience
  }
}

const GOOGLE_NOTICE: Record<string, string> = {
  connected: "Signed in with Google.",
  denied: "Google sign-in was cancelled.",
  "not-configured": "Google sign-in isn't set up on the server yet - see Settings.",
};

/** Articles: import from Google Sheets/Docs, edit with on-page SEO help, publish to the project's WordPress. */
export function ArticlesTab() {
  const searchParams = useSearchParams();
  const urlProject = useRef(searchParams.get("project"));
  const [view, setView] = useState<View>(() => (searchParams.get("view") === "settings" ? "settings" : "list"));
  const [articleId, setArticleId] = useState<string | null>(() => searchParams.get("article"));
  const [importOpen, setImportOpen] = useState(() => searchParams.get("import") === "1");
  const [notice, setNotice] = useState<string | null>(() => {
    const g = searchParams.get("google");
    if (!g) return null;
    return g === "error" ? `Google sign-in failed: ${searchParams.get("message") ?? "unknown error"}` : GOOGLE_NOTICE[g] ?? null;
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [items, setItems] = useState<ArticleSummary[] | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [wp, setWp] = useState<WordPressSettingsView | null>(null);
  const [wpLoaded, setWpLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGoogle = useCallback(async () => {
    const res = await fetch("/api/google/status", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setGoogle((await res.json()) as GoogleStatus);
  }, []);

  const loadArticles = useCallback(async (project: string) => {
    const res = await fetch(`/api/articles?project=${encodeURIComponent(project)}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { items?: ArticleSummary[] };
    setItems(data.items ?? []);
  }, []);

  useEffect(() => {
    async function init() {
      const res = await fetch("/api/tracking/projects", { cache: "no-store" });
      const list = ((await res.json()) as { projects?: ProjectSummary[] }).projects ?? [];
      setProjects(list);
      const remembered = readStorage(PROJECT_STORAGE_KEY);
      const pick = [urlProject.current, remembered].find((id) => id && list.some((p) => p.id === id));
      setProjectId(pick ?? list[0]?.id ?? null);
      await loadGoogle();
    }
    void init();
  }, [loadGoogle]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    async function load(project: string) {
      const [, settingsRes] = await Promise.all([loadArticles(project), fetch(`/api/wordpress/settings?project=${encodeURIComponent(project)}`, { cache: "no-store" })]);
      const data = (await settingsRes.json().catch(() => ({}))) as { settings?: WordPressSettingsView | null };
      if (cancelled) return;
      setWp(data.settings ?? null);
      setWpLoaded(true);
    }
    void load(projectId);
    return () => {
      cancelled = true;
    };
  }, [projectId, loadArticles]);

  useEffect(() => {
    writeParams({
      project: projectId ?? undefined,
      view: articleId ? null : view === "settings" ? "settings" : null,
      article: articleId,
      import: null,
      google: null,
      message: null,
    });
  }, [projectId, view, articleId]);

  const createProject = useCallback(async (input: NewProjectInput) => {
    const res = await fetch("/api/tracking/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) throw new Error(body.error || "Couldn't create the project");
    const list = ((await (await fetch("/api/tracking/projects", { cache: "no-store" })).json()) as { projects: ProjectSummary[] }).projects;
    setProjects(list);
    writeStorage(PROJECT_STORAGE_KEY, body.id);
    setArticleId(null);
    setItems(null);
    setProjectId(body.id);
  }, []);

  async function newArticle() {
    if (!projectId) return;
    setError(null);
    const res = await fetch("/api/articles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectId }) });
    const data = (await res.json().catch(() => ({}))) as { article?: { id: string }; error?: string };
    if (!data.article) {
      setError(data.error ?? "Couldn't create the article");
      return;
    }
    await loadArticles(projectId);
    setArticleId(data.article.id);
  }

  async function importSamples() {
    if (!projectId) return;
    setError(null);
    // The same rows the sample content plan has, mapped the way the import dialog would.
    const plan = (await (await fetch("/api/articles/sheet?url=sample")).json()) as SheetPreview;
    const cell = (row: SheetPreview["rows"][number], field: PlanField) => (plan.mapping[field] >= 0 ? row.cells[plan.mapping[field]] : "");
    const res = await fetch("/api/articles/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: projectId,
        items: plan.rows.map((row) => ({
          rowNumber: row.rowNumber,
          sheetId: plan.spreadsheetId,
          sheetTab: plan.tab,
          docUrl: row.links[plan.mapping.docUrl] ?? "",
          title: cell(row, "title"),
          focusKeyword: cell(row, "focusKeyword"),
          secondaryKeywords: cell(row, "secondaryKeywords"),
          categories: cell(row, "categories"),
          tags: cell(row, "tags"),
          publishDate: cell(row, "publishDate"),
          status: cell(row, "status"),
        })),
      }),
    });
    if (!res.ok) setError("Couldn't add the sample articles");
    await loadArticles(projectId);
  }

  async function deleteArticle(id: string) {
    if (!projectId) return;
    await fetch(`/api/articles/item?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadArticles(projectId);
  }

  const connectedHost = wp?.siteUrl ? wp.siteUrl.replace(/^https?:\/\//, "") : null;

  return (
    <div className="flex flex-col gap-5">
      {!articleId ? (
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              Articles
            </h2>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Import from Google Sheets &amp; Docs, polish on-page SEO with ChatGPT, and publish to WordPress.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {projects.length > 0 ? (
              <ProjectBar
                projects={projects}
                activeId={projectId}
                onSelect={(id) => {
                  writeStorage(PROJECT_STORAGE_KEY, id);
                  setArticleId(null);
                  setItems(null);
                  setWpLoaded(false);
                  setProjectId(id);
                }}
                onCreate={createProject}
              />
            ) : null}
          </div>
        </header>
      ) : null}

      {notice ? (
        <p className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm" role="status" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", background: "var(--surface-1)" }}>
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-xs underline" style={{ color: "var(--text-muted)" }}>
            Dismiss
          </button>
        </p>
      ) : null}

      {projectId && articleId ? (
        <ArticleEditor
          key={articleId}
          projectId={projectId}
          articleId={articleId}
          settings={wp}
          onBack={() => setArticleId(null)}
          onOpenSettings={() => {
            setArticleId(null);
            setView("settings");
          }}
          onChanged={() => void loadArticles(projectId)}
        />
      ) : projectId ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={view}
              options={[
                { value: "list", label: `Articles${items ? ` (${items.length})` : ""}` },
                { value: "settings", label: "Settings" },
              ]}
              onChange={setView}
              ariaLabel="Articles view"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: wpLoaded && !wp ? "var(--status-critical)" : "var(--text-muted)" }}>
                {!wpLoaded ? "" : connectedHost ? `WordPress: ${connectedHost}${wp?.lastTest?.ok === false ? " (connection failing)" : ""}` : "WordPress not connected"}
                {google?.signedIn ? ` · Google: ${google.email ?? "signed in"}` : ""}
              </span>
              {view === "list" ? (
                <>
                  <button type="button" onClick={() => void newArticle()} className={buttonSecondary} style={secondaryStyle}>
                    New article
                  </button>
                  <button type="button" onClick={() => setImportOpen(true)} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
                    Import from Google
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {error ? (
            <p className="text-sm" style={{ color: "var(--status-critical)" }}>
              {error}
            </p>
          ) : null}
          {view === "list" ? (
            <ArticleList items={items} onOpen={setArticleId} onDelete={(id) => void deleteArticle(id)} onNew={() => void newArticle()} onImport={() => setImportOpen(true)} onSample={() => void importSamples()} />
          ) : wpLoaded ? (
            <ArticleSettings key={projectId} projectId={projectId} google={google} onGoogleChange={() => void loadGoogle()} settings={wp} onSettingsChange={setWp} />
          ) : null}
        </>
      ) : null}

      {importOpen && projectId ? <ImportDialog projectId={projectId} google={google} onClose={() => setImportOpen(false)} onImported={() => void loadArticles(projectId)} /> : null}
    </div>
  );
}
