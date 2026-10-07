"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { analyzeSeo } from "@/lib/articles/seo";
import type { Article, ArticleSuggestions } from "@/lib/articles/types";
import type { WordPressSettingsView } from "@/lib/wordpress/store";
import { Segmented } from "@/components/tracking/ui";
import { PublishPanel, type PublishDraft } from "./PublishPanel";
import { RichEditor, appendHeading, applyAltTexts } from "./RichEditor";
import { SeoPanel, type SeoDraft } from "./SeoPanel";
import { StatusBadge, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

type Draft = SeoDraft & PublishDraft & { contentHtml: string; notes?: string };

function draftOf(a: Article): Draft {
  return {
    title: a.title,
    focusKeyword: a.focusKeyword,
    secondaryKeywords: a.secondaryKeywords,
    metaTitle: a.metaTitle,
    metaDescription: a.metaDescription,
    slug: a.slug,
    excerpt: a.excerpt,
    categories: a.categories,
    tags: a.tags,
    publish: a.publish,
    status: a.status,
    featuredImage: a.featuredImage,
    contentHtml: a.contentHtml,
    notes: a.notes,
  };
}

export function ArticleEditor({
  projectId,
  articleId,
  settings,
  onBack,
  onOpenSettings,
  onChanged,
}: {
  projectId: string;
  articleId: string;
  settings: WordPressSettingsView | null;
  onBack: () => void;
  onOpenSettings: () => void;
  onChanged: () => void;
}) {
  const [article, setArticle] = useState<Article | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"seo" | "publish">("seo");
  const [suggestions, setSuggestions] = useState<ArticleSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ warnings: string[]; error: string | null } | null>(null);
  const [reimporting, setReimporting] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const editorRef = useRef<Editor | null>(null);
  const siteHost = settings?.siteUrl ? new URL(settings.siteUrl).hostname : undefined;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/articles/item?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(articleId)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { article?: Article; error?: string };
      if (cancelled) return;
      if (!data.article) {
        setLoadError(data.error ?? "Couldn't open this article");
        return;
      }
      setArticle(data.article);
      setDraft(draftOf(data.article));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, articleId]);

  useEffect(() => {
    if (!settings?.hasPassword) return;
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/wordpress/terms?project=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { categories?: Array<{ name: string }> };
      if (!cancelled) setCategories((data.categories ?? []).map((c) => c.name));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, settings?.hasPassword, settings?.siteUrl]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<Article | null> => {
    if (!draft) return null;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/articles/item?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(articleId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, featuredImage: draft.featuredImage ?? null, publish: { mode: draft.publish.mode, date: draft.publish.date ?? null } }),
      });
      const data = (await res.json().catch(() => ({}))) as { article?: Article; error?: string };
      if (!res.ok || !data.article) throw new Error(data.error ?? "Couldn't save");
      setArticle(data.article);
      // Keep the editor's own HTML (the server's cleaned copy is equivalent) so the cursor doesn't jump.
      setDraft((d) => (d ? { ...draftOf(data.article!), contentHtml: d.contentHtml } : d));
      setDirty(false);
      onChanged();
      return data.article;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save");
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, projectId, articleId, onChanged]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const report = useMemo(() => (draft ? analyzeSeo(draft, siteHost) : null), [draft, siteHost]);

  async function suggest() {
    if (!draft) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch("/api/articles/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, id: articleId, draft: { ...draft, featuredImage: draft.featuredImage ?? null } }),
      });
      const data = (await res.json().catch(() => ({}))) as { suggestions?: ArticleSuggestions; error?: string };
      if (!res.ok || !data.suggestions) throw new Error(data.error ?? "Suggestions failed");
      setSuggestions(data.suggestions);
      setPanel("seo");
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : "Suggestions failed");
    } finally {
      setSuggesting(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setPublishResult(null);
    const saved = dirty ? await save() : article;
    if (!saved) {
      setPublishing(false);
      setPublishResult({ warnings: [], error: "Save failed - fix that first." });
      return;
    }
    try {
      const res = await fetch("/api/articles/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, id: articleId }),
      });
      const data = (await res.json().catch(() => ({}))) as { article?: Article; warnings?: string[]; error?: string };
      if (!res.ok || !data.article) throw new Error(data.error ?? "Publishing failed");
      setArticle(data.article);
      setDraft((d) => (d ? { ...d, status: data.article!.status } : d));
      setPublishResult({ warnings: data.warnings ?? [], error: null });
    } catch (err) {
      setPublishResult({ warnings: [], error: err instanceof Error ? err.message : "Publishing failed" });
      setDraft((d) => (d ? { ...d, status: "error" } : d));
    } finally {
      setPublishing(false);
      onChanged();
    }
  }

  async function reimport() {
    if (!article?.source.docUrl || !draft) return;
    if (!window.confirm("Replace the article body with the current Google Doc? Your edits to the body here will be lost (SEO fields are kept).")) return;
    setReimporting(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/articles/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectId,
          overwrite: true,
          items: [{ docUrl: article.source.docUrl, title: draft.title, sheetId: article.source.sheetId, sheetTab: article.source.sheetTab, rowNumber: article.source.sheetRow }],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { results?: Array<{ status: string; error?: string }>; error?: string };
      const r = data.results?.[0];
      if (!res.ok || !r || r.status === "failed") throw new Error(r?.error ?? data.error ?? "Re-import failed");
      const fresh = await fetch(`/api/articles/item?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(articleId)}`, { cache: "no-store" });
      const body = (await fresh.json()) as { article?: Article };
      if (body.article) {
        setArticle(body.article);
        setDraft(draftOf(body.article));
        setDirty(false);
      }
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Re-import failed");
    } finally {
      setReimporting(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onBack} className="self-start text-sm" style={{ color: "var(--series-1)" }}>
          ← All articles
        </button>
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          {loadError}
        </p>
      </div>
    );
  }
  if (!draft || !article || !report) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading article...
      </p>
    );
  }

  const source = article.source;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!dirty || window.confirm("Leave without saving your changes?")) onBack();
            }}
            className="text-sm font-medium"
            style={{ color: "var(--series-1)" }}
          >
            ← All articles
          </button>
          <StatusBadge status={draft.status} wordpress={article.wordpress} />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {source.type === "sheet" ? `From sheet row ${source.sheetRow ?? "?"}${source.sheetTab ? ` (${source.sheetTab})` : ""}` : source.type === "doc" ? "From a Google Doc" : source.type === "sample" ? "Sample article" : "Written here"}
            {source.docUrl && !source.docUrl.startsWith("sample:") ? (
              <>
                {" · "}
                <a href={source.docUrl} target="_blank" rel="noreferrer" className="underline">
                  Open Doc ↗
                </a>
              </>
            ) : null}
            {article.notes ? ` · ${article.notes}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: saveError ? "var(--status-critical)" : "var(--text-muted)" }} role="status">
            {saveError ?? (saving ? "Saving..." : dirty ? "Unsaved changes" : `Saved ${new Date(article.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`)}
          </span>
          {source.docUrl ? (
            <button type="button" onClick={() => void reimport()} disabled={reimporting} className={buttonSecondary} style={secondaryStyle} title="Replace the body with the Doc's current content">
              {reimporting ? "Re-importing..." : "Re-import Doc"}
            </button>
          ) : null}
          <button type="button" onClick={() => void save()} disabled={saving || !dirty} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
            Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-3">
          <input
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Post title (H1)"
            aria-label="Post title"
            className="w-full rounded-xl border px-4 py-3 text-xl font-semibold outline-none"
            style={{ ...fieldStyle, background: "var(--surface-1)" }}
          />
          <RichEditor
            value={draft.contentHtml}
            onChange={(html) => update({ contentHtml: html })}
            projectId={projectId}
            focusKeyword={draft.focusKeyword}
            onReady={(e) => {
              editorRef.current = e;
            }}
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-3 rounded-xl border p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
          <Segmented
            value={panel}
            options={[
              { value: "seo", label: `On-page SEO · ${report.score}` },
              { value: "publish", label: "Publish" },
            ]}
            onChange={setPanel}
            ariaLabel="Sidebar"
          />
          {panel === "seo" ? (
            <SeoPanel
              draft={draft}
              onChange={update}
              report={report}
              siteHost={siteHost}
              suggestions={suggestions}
              suggesting={suggesting}
              suggestError={suggestError}
              onSuggest={() => void suggest()}
              onApplyAlts={(alts) => {
                if (editorRef.current) applyAltTexts(editorRef.current, alts);
                const featured = draft.featuredImage && alts.find((a) => a.src === draft.featuredImage!.src);
                if (featured) update({ featuredImage: { ...draft.featuredImage!, alt: featured.alt } });
              }}
              onAddHeading={(text) => editorRef.current && appendHeading(editorRef.current, text)}
            />
          ) : (
            <PublishPanel
              projectId={projectId}
              draft={draft}
              onChange={update}
              wordpress={article.wordpress}
              settings={settings}
              categories={categories}
              focusKeyword={draft.focusKeyword}
              publishing={publishing}
              result={publishResult}
              onPublish={() => void publish()}
              onOpenSettings={onOpenSettings}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
