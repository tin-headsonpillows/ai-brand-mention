"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { analyzeSeo } from "@/lib/articles/seo";
import type { Article, ArticleSuggestions } from "@/lib/articles/types";
import type { WordPressSettingsView } from "@/lib/wordpress/store";
import { Segmented } from "@/components/tracking/ui";
import { PublishPanel, type PublishDraft } from "./PublishPanel";
import { ReviewPanel } from "./ReviewPanel";
import { TranslateDialog } from "./TranslateDialog";
import { languageLabel } from "@/lib/articles/languages";
import { RichEditor, appendHeading, applyAltTexts } from "./RichEditor";
import { SeoPanel, type SeoDraft } from "./SeoPanel";
import { StatusBadge, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

type Draft = SeoDraft & PublishDraft & { contentHtml: string; notes?: string };

const AUTOSAVE_MS = 2500;

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
  canEdit = true,
  canReply = true,
  onOpenArticle,
}: {
  projectId: string;
  articleId: string;
  settings: WordPressSettingsView | null;
  onBack: () => void;
  onOpenSettings: () => void;
  onChanged: () => void;
  /** The viewer's project role allows editing (editor/owner) and replying to Doc comments (reviewer and up). */
  canEdit?: boolean;
  canReply?: boolean;
  /** Opens another article (a translation, or the original of one). */
  onOpenArticle?: (id: string) => void;
}) {
  const [article, setArticle] = useState<Article | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"seo" | "publish" | "review">("seo");
  const [pushing, setPushing] = useState(false);
  const [docChanged, setDocChanged] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [suggestions, setSuggestions] = useState<ArticleSuggestions | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ warnings: string[]; error: string | null } | null>(null);
  const [reimporting, setReimporting] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const editorRef = useRef<Editor | null>(null);
  // Bumped on every edit, so a save that finishes after newer edits doesn't mark them saved.
  const editVersion = useRef(0);
  const inFlight = useRef<Promise<Article | null> | null>(null);
  const latest = useRef<{ draft: Draft | null; dirty: boolean }>({ draft: null, dirty: false });
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
    if (!canEdit) return;
    editVersion.current++;
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  }, [canEdit]);

  useEffect(() => {
    latest.current = { draft, dirty };
  }, [draft, dirty]);

  const itemUrl = `/api/articles/item?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(articleId)}`;
  const bodyOf = (d: Draft) => JSON.stringify({ ...d, featuredImage: d.featuredImage ?? null, publish: { mode: d.publish.mode, date: d.publish.date ?? null } });

  const save = useCallback(async (): Promise<Article | null> => {
    if (!draft) return null;
    // One save at a time; the next autosave picks up edits made meanwhile.
    if (inFlight.current) await inFlight.current;
    const version = editVersion.current;
    const run = (async () => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(itemUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: bodyOf(draft) });
        const data = (await res.json().catch(() => ({}))) as { article?: Article; error?: string };
        if (!res.ok || !data.article) throw new Error(data.error ?? `Couldn't save (${res.status})`);
        setArticle(data.article);
        if (editVersion.current === version) {
          // Keep the editor's own HTML (the server's cleaned copy is equivalent) so the cursor doesn't jump.
          setDraft((d) => (d ? { ...draftOf(data.article!), contentHtml: d.contentHtml } : d));
          setDirty(false);
        }
        onChanged();
        return data.article;
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Couldn't save");
        return null;
      } finally {
        setSaving(false);
      }
    })();
    inFlight.current = run;
    const result = await run;
    inFlight.current = null;
    return result;
  }, [draft, itemUrl, onChanged]);

  // Autosave a few seconds after the last edit.
  useEffect(() => {
    if (!dirty || saveError) return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, save, saveError]);

  // Leaving the editor (another tab, the board, the article list) saves what's pending instead of dropping it.
  useEffect(() => {
    const flush = () => {
      const { draft: d, dirty: isDirty } = latest.current;
      if (!d || !isDirty) return;
      latest.current = { draft: d, dirty: false };
      void fetch(itemUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: bodyOf(d), keepalive: bodyOf(d).length < 60_000 });
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [itemUrl]);

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
  const localImages = useMemo(() => {
    if (!draft || !siteHost) return 0;
    const host = siteHost.replace(/^www\./, "");
    return [...draft.contentHtml.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)].filter((m) => {
      try {
        return new URL(m[1].replace(/&amp;/g, "&"), "http://local").hostname.replace(/^www\./, "") !== host;
      } catch {
        return true;
      }
    }).length;
  }, [draft, siteHost]);

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
        editVersion.current++;
        latest.current = { draft: null, dirty: false };
        setArticle(body.article);
        setDraft(draftOf(body.article));
        setDirty(false);
        setDocChanged(false);
        setNotice("Re-imported the Doc's current text.");
      }
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Re-import failed");
    } finally {
      setReimporting(false);
    }
  }

  /** Uploads the body's images to WordPress now; the article then uses the WordPress links. */
  async function uploadImagesToWp() {
    setUploadingImages(true);
    setSaveError(null);
    try {
      if (dirty && !(await save())) throw new Error("Save failed - fix that first.");
      const res = await fetch("/api/wordpress/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, articleId, action: "uploadAll" }),
      });
      const data = (await res.json().catch(() => ({}))) as { article?: Article; uploaded?: unknown[]; failed?: Array<{ error: string }>; error?: string };
      if (!res.ok || !data.article) throw new Error(data.error ?? "Upload failed");
      editVersion.current++;
      setArticle(data.article);
      setDraft((d) => (d ? { ...d, contentHtml: data.article!.contentHtml } : d));
      setNotice(`${data.uploaded?.length ?? 0} image(s) uploaded to WordPress; the article now uses their WordPress links.${data.failed?.length ? ` ${data.failed.length} failed: ${data.failed[0].error}` : ""}`);
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingImages(false);
    }
  }

  async function pushToDoc(force = false) {
    if (!article?.source.docUrl) return;
    if (!force && !window.confirm("Replace the Google Doc's text with this article?\n\nComments stay in the Doc but lose their place in the text, and pending suggested edits are dropped. Google keeps the old text in the Doc's version history.")) return;
    setPushing(true);
    setSaveError(null);
    try {
      if (dirty && !(await save())) throw new Error("Save failed - fix that first.");
      const res = await fetch("/api/articles/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, id: articleId, force }),
      });
      const data = (await res.json().catch(() => ({}))) as { article?: Article; simulated?: boolean; conflict?: boolean; error?: string };
      if (res.status === 409 && data.conflict) {
        if (window.confirm(`${data.error}\n\nOverwrite the Doc anyway?`)) return void (await pushToDoc(true));
        return;
      }
      if (!res.ok || !data.article) throw new Error(data.error ?? "Couldn't update the Doc");
      setArticle(data.article);
      setDocChanged(false);
      setNotice(data.simulated ? "Sample article: the Doc update is simulated." : "The Google Doc now has this article's text.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't update the Doc");
    } finally {
      setPushing(false);
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
            onClick={onBack}
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
          {article.translationOf ? (
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {languageLabel(article.lang ?? "")} translation ·{" "}
              <button type="button" onClick={() => onOpenArticle?.(article.translationOf!.id)} className="underline" style={{ color: "var(--series-1)" }}>
                open the original
              </button>
              {article.translationOf.untranslated ? <span style={{ color: "var(--status-critical)" }}> · {article.translationOf.untranslated} passage(s) left untranslated</span> : null}
            </span>
          ) : article.translations && Object.keys(article.translations).length ? (
            <span className="flex flex-wrap items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Translations:
              {Object.entries(article.translations).map(([lang, id]) => (
                <button key={lang} type="button" onClick={() => onOpenArticle?.(id)} className="rounded border px-1.5 py-0.5" style={{ borderColor: "var(--border-hairline)", color: "var(--series-1)" }} title={languageLabel(lang)}>
                  {lang.toUpperCase()}
                </button>
              ))}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: saveError ? "var(--status-critical)" : "var(--text-muted)" }} role="status">
            {saveError ? `${saveError} - retry with Save` : saving ? "Saving..." : dirty ? "Editing… (autosaves)" : `Saved ${new Date(article.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          </span>
          {source.docUrl && canEdit ? (
            <>
              <button
                type="button"
                onClick={() => void reimport()}
                disabled={reimporting}
                className={buttonSecondary}
                style={docChanged ? { ...secondaryStyle, borderColor: "var(--series-1)", color: "var(--series-1)" } : secondaryStyle}
                title="Replace the body with the Doc's current content"
              >
                {reimporting ? "Re-importing..." : docChanged ? "Re-import Doc (changed)" : "Re-import Doc"}
              </button>
              <button type="button" onClick={() => void pushToDoc()} disabled={pushing} className={buttonSecondary} style={secondaryStyle} title="Write this article into the Google Doc">
                {pushing ? "Updating Doc..." : "Update Doc"}
              </button>
            </>
          ) : null}
          {canEdit && !article.translationOf ? (
            <button type="button" onClick={() => setTranslating(true)} className={buttonSecondary} style={secondaryStyle}>
              Translate
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" onClick={() => void save()} disabled={saving || !dirty} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              Save
            </button>
          ) : (
            <span className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-muted)" }}>
              View only
            </span>
          )}
        </div>
      </div>

      {translating ? (
        <TranslateDialog
          projectId={projectId}
          article={{ ...article, ...draft }}
          siteHost={siteHost}
          beforeRun={async () => (dirty ? Boolean(await save()) : true)}
          onClose={() => setTranslating(false)}
          onOpen={(id) => {
            setTranslating(false);
            onOpenArticle?.(id);
          }}
          onDone={async () => {
            const res = await fetch(itemUrl, { cache: "no-store" });
            const data = (await res.json().catch(() => ({}))) as { article?: Article };
            if (data.article) setArticle((a) => (a ? { ...a, translations: data.article!.translations } : a));
            onChanged();
          }}
        />
      ) : null}

      {notice ? (
        <p className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs" role="status" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", background: "var(--surface-1)" }}>
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="underline" style={{ color: "var(--text-muted)" }}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-3">
          <input
            value={draft.title}
            readOnly={!canEdit}
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
            readOnly={!canEdit}
            wordpress={Boolean(settings?.hasPassword)}
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
              { value: "seo", label: `SEO · ${report.score}` },
              { value: "publish", label: "Publish" },
              ...(source.docUrl ? [{ value: "review" as const, label: docChanged ? "Doc review •" : "Doc review" }] : []),
            ]}
            onChange={setPanel}
            ariaLabel="Sidebar"
          />
          {panel === "review" && source.docUrl ? (
            <ReviewPanel
              projectId={projectId}
              articleId={articleId}
              docUrl={source.docUrl}
              canReply={canReply}
              canEdit={canEdit}
              onReimport={() => void reimport()}
              onPush={() => void pushToDoc()}
              pushing={pushing}
              onChangedState={setDocChanged}
            />
          ) : panel === "seo" ? (
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
              onUploadImages={canEdit ? () => void uploadImagesToWp() : undefined}
              uploadingImages={uploadingImages}
              localImages={localImages}
              onOpenSettings={onOpenSettings}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
