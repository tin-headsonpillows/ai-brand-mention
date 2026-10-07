"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ImageHit, InstagramProfile, LibraryItem } from "@/lib/images/types";
import type { ProjectSummary, SerpUsage } from "@/lib/tracking/types";
import { writeParams } from "@/lib/urlState";
import { ProjectBar, type NewProjectInput } from "@/components/tracking/ProjectBar";
import { EmptyState, Segmented, Switch } from "@/components/tracking/ui";
import { SerpUsageBadge } from "@/components/SerpUsageBadge";
import { ImageGrid } from "./ImageGrid";
import { CropStudio } from "./CropStudio";
import { GeneratePanel } from "./GeneratePanel";
import { LibraryPanel } from "./LibraryPanel";
import type { SelectedImage } from "./imageClient";

type Source = "google" | "instagram" | "generate" | "library";
const SOURCES: Array<{ value: Source; label: string }> = [
  { value: "google", label: "Google Images" },
  { value: "instagram", label: "Instagram" },
  { value: "generate", label: "AI generator" },
  { value: "library", label: "Library" },
];
const PROJECT_STORAGE_KEY = "tracking.project";

const fieldStyle: React.CSSProperties = {
  borderColor: "var(--border-hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
};

function hitToSelected(hit: ImageHit): SelectedImage {
  return {
    key: `${hit.kind}-${hit.full}`,
    kind: hit.kind,
    src: hit.full,
    thumb: hit.thumbnail,
    title: hit.title,
    width: hit.width,
    height: hit.height,
    pageUrl: hit.pageUrl,
  };
}

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

export function ImagesTab() {
  const searchParams = useSearchParams();
  const urlProject = useRef(searchParams.get("project"));
  const [source, setSource] = useState<Source>(() => {
    const value = searchParams.get("source");
    return SOURCES.some((s) => s.value === value) ? (value as Source) : "google";
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [usage, setUsage] = useState<SerpUsage | null>(null);
  const [mock, setMock] = useState<{ search: boolean; generate: boolean } | null>(null);

  // Selection survives switching sources, so images from Google, Instagram and the generator can go in one ZIP.
  const [selection, setSelection] = useState<SelectedImage[]>([]);
  const [studioOpen, setStudioOpen] = useState(false);

  // Google
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [cc, setCc] = useState(false);
  const [photosOnly, setPhotosOnly] = useState(false);
  const [largeOnly, setLargeOnly] = useState(false);
  const [googleHits, setGoogleHits] = useState<SelectedImage[]>([]);
  const [googlePage, setGooglePage] = useState(0);
  const [googleMore, setGoogleMore] = useState(false);
  const [googleQuery, setGoogleQuery] = useState<string | null>(null);

  // Instagram
  const [username, setUsername] = useState(() => searchParams.get("ig") ?? "");
  const [profile, setProfile] = useState<InstagramProfile | null>(null);
  const [igHits, setIgHits] = useState<SelectedImage[]>([]);
  const [igToken, setIgToken] = useState<string | null>(null);
  const [igUser, setIgUser] = useState<string | null>(null);

  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedKeys = new Set(selection.map((s) => s.key));
  const savedSources = new Set((library ?? []).map((i) => i.sourceUrl).filter((u): u is string => Boolean(u)));
  const unsavedSelection = selection.filter((s) => (s.kind === "google" || s.kind === "instagram") && !savedSources.has(s.src));

  const loadUsage = useCallback(async () => {
    const res = await fetch("/api/tracking/usage", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setUsage((await res.json()) as SerpUsage);
  }, []);

  const loadLibrary = useCallback(async (project: string) => {
    const res = await fetch(`/api/images/library?project=${encodeURIComponent(project)}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { items?: LibraryItem[]; mock?: { search: boolean; generate: boolean }; defaultModel?: string };
    setLibrary(data.items ?? []);
    if (data.mock) setMock(data.mock);
    if (data.defaultModel) setDefaultModel(data.defaultModel);
  }, []);

  useEffect(() => {
    async function init() {
      const res = await fetch("/api/tracking/projects", { cache: "no-store" });
      const list = ((await res.json()) as { projects?: ProjectSummary[] }).projects ?? [];
      setProjects(list);
      const remembered = readStorage(PROJECT_STORAGE_KEY);
      const pick = [urlProject.current, remembered].find((id) => id && list.some((p) => p.id === id));
      setProjectId(pick ?? list[0]?.id ?? null);
      await loadUsage();
    }
    void init();
  }, [loadUsage]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    async function load(project: string) {
      setLibrary(null);
      if (!cancelled) await loadLibrary(project);
    }
    void load(projectId);
    return () => {
      cancelled = true;
    };
  }, [projectId, loadLibrary]);

  useEffect(() => {
    writeParams({
      project: projectId ?? undefined,
      source,
      q: source === "google" ? googleQuery ?? undefined : null,
      ig: source === "instagram" ? igUser ?? undefined : null,
    });
  }, [projectId, source, googleQuery, igUser]);

  const createProject = useCallback(async (input: NewProjectInput) => {
    const res = await fetch("/api/tracking/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) throw new Error(body.error || "Couldn't create the project");
    const list = ((await (await fetch("/api/tracking/projects", { cache: "no-store" })).json()) as { projects: ProjectSummary[] }).projects;
    setProjects(list);
    writeStorage(PROJECT_STORAGE_KEY, body.id);
    setProjectId(body.id);
  }, []);

  function toggle(image: SelectedImage) {
    setSelection((current) => (current.some((s) => s.key === image.key) ? current.filter((s) => s.key !== image.key) : [...current, image]));
  }

  async function searchGoogle(page: number) {
    const q = (page === 0 ? query : googleQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, page: String(page), ...(cc ? { cc: "1" } : {}), ...(photosOnly ? { photos: "1" } : {}), ...(largeOnly ? { large: "1" } : {}) });
      const res = await fetch(`/api/images/search?${params}`);
      const data = (await res.json()) as { hits?: ImageHit[]; hasMore?: boolean; error?: string };
      if (!res.ok || !data.hits) throw new Error(data.error ?? "Search failed");
      const mapped = data.hits.map(hitToSelected);
      setGoogleHits((h) => (page === 0 ? mapped : [...h, ...mapped.filter((m) => !h.some((x) => x.key === m.key))]));
      setGooglePage(page);
      setGoogleMore(Boolean(data.hasMore));
      setGoogleQuery(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
      void loadUsage();
    }
  }

  async function loadInstagram(more: boolean) {
    const user = more ? igUser : username;
    if (!user?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ username: user.trim(), ...(more && igToken ? { token: igToken } : {}) });
      const res = await fetch(`/api/images/instagram?${params}`);
      const data = (await res.json()) as { profile?: InstagramProfile | null; hits?: ImageHit[]; nextPageToken?: string | null; error?: string };
      if (!res.ok || !data.hits) throw new Error(data.error ?? "Couldn't load that profile");
      const mapped = data.hits.map(hitToSelected);
      if (!more) {
        setProfile(data.profile ?? null);
        setIgHits(mapped);
        setIgUser(data.profile?.username ?? user.trim().replace(/^@/, ""));
      } else {
        setIgHits((h) => [...h, ...mapped.filter((m) => !h.some((x) => x.key === m.key))]);
      }
      setIgToken(data.nextPageToken ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that profile");
    } finally {
      setLoading(false);
      void loadUsage();
    }
  }

  /** Saves Google / Instagram results to the project library at their original size (no SerpApi credits). */
  async function saveToLibrary(images: SelectedImage[]) {
    if (!projectId) return;
    const todo = images.filter((i) => (i.kind === "google" || i.kind === "instagram") && !savedSources.has(i.src) && !saving.has(i.src));
    if (todo.length === 0) return;
    setSaving((s) => new Set([...s, ...todo.map((i) => i.src)]));
    setNotice(null);
    try {
      const res = await fetch("/api/images/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectId,
          images: todo.map((i) => ({ url: i.src, kind: i.kind, title: i.title, pageUrl: i.pageUrl })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { saved?: LibraryItem[]; already?: LibraryItem[]; failed?: Array<{ url: string; error: string }>; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save to the library");
      const savedCount = (data.saved?.length ?? 0) + (data.already?.length ?? 0);
      const failed = data.failed ?? [];
      setNotice(
        [
          savedCount ? `Saved ${savedCount} image${savedCount === 1 ? "" : "s"} to the library.` : "",
          failed.length ? `${failed.length} couldn't be downloaded (${failed[0].error}) - the site may block downloads; try Crop & download instead.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
      await loadLibrary(projectId);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't save to the library");
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        todo.forEach((i) => next.delete(i.src));
        return next;
      });
    }
  }

  const libraryActions = { saved: savedSources, saving, onSave: (images: SelectedImage[]) => void saveToLibrary(images) };

  async function deleteLibraryItem(id: string) {
    if (!projectId) return;
    await fetch(`/api/images/library?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setSelection((s) => s.filter((x) => x.libraryId !== id));
    await loadLibrary(projectId);
  }

  return (
    <div className="flex flex-col gap-5 pb-32 sm:pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Images
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Find images on Google or an Instagram profile - or generate one - then crop to an exact size and download as JPG.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 ? (
            <ProjectBar
              projects={projects}
              activeId={projectId}
              onSelect={(id) => {
                writeStorage(PROJECT_STORAGE_KEY, id);
                setProjectId(id);
              }}
              onCreate={createProject}
            />
          ) : null}
          <SerpUsageBadge usage={usage} />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={source}
          options={SOURCES.map((s) => ({ value: s.value, label: s.value === "library" && library ? `${s.label} (${library.length})` : s.label }))}
          onChange={(v) => {
            setSource(v);
            setError(null);
            setNotice(null);
          }}
          ariaLabel="Image source"
        />
        {mock && (mock.search || mock.generate) ? (
          <span className="text-xs" style={{ color: "var(--status-warning)" }}>
            {mock.search ? "No SerpApi key - search results are placeholders. " : ""}
            {mock.generate ? "No OpenAI key - generation makes placeholders." : ""}
          </span>
        ) : null}
      </div>

      {source === "google" ? (
        <section className="flex flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchGoogle(0);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Google Images, e.g. Da Nang beach sunrise"
              className="min-w-[260px] flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={fieldStyle}
            />
            <button type="submit" disabled={loading || !query.trim()} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--series-1)" }}>
              {loading ? "Searching..." : "Search"}
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-4">
            <Switch checked={cc} onChange={setCc} label="Creative Commons licences only" />
            <Switch checked={photosOnly} onChange={setPhotosOnly} label="Photos only" />
            <Switch checked={largeOnly} onChange={setLargeOnly} label="Large images only" />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              ~100 images per page · 1 SerpApi credit per page. Most images are copyrighted - check the source page before publishing.
            </span>
          </div>
          {googleHits.length > 0 ? (
            <>
              <ImageGrid images={googleHits} selected={selectedKeys} onToggle={toggle} library={libraryActions} />
              {googleMore ? (
                <button type="button" onClick={() => void searchGoogle(googlePage + 1)} disabled={loading} className="self-center rounded-lg border px-4 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
                  {loading ? "Loading..." : "Load more (1 credit)"}
                </button>
              ) : null}
            </>
          ) : !loading ? (
            <EmptyState title="Search Google Images" body="Results show each image's size and source; select the ones you want, then crop and download them as JPG or save them to the project library." />
          ) : null}
        </section>
      ) : source === "instagram" ? (
        <section className="flex flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadInstagram(false);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Instagram username or profile link, e.g. @adlibhotels"
              className="min-w-[260px] flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={fieldStyle}
            />
            <button type="submit" disabled={loading || !username.trim()} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--series-1)" }}>
              {loading ? "Loading..." : "Load posts"}
            </button>
          </form>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Public profiles only · recent posts, 1 SerpApi credit per page. Instagram serves images at up to ~1080px (often 640px).
          </p>
          {profile ? (
            <div className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
              {profile.picture ? (
                // eslint-disable-next-line @next/next/no-img-element -- profile picture
                <img src={profile.picture} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-full object-cover" />
              ) : null}
              <div className="flex flex-col">
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  @{profile.username}
                  {profile.fullName ? <span className="font-normal" style={{ color: "var(--text-secondary)" }}> · {profile.fullName}</span> : null}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {[profile.followers != null ? `${profile.followers.toLocaleString()} followers` : null, profile.postsCount != null ? `${profile.postsCount.toLocaleString()} posts` : null, profile.isPrivate ? "private account" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
          ) : null}
          {igHits.length > 0 ? (
            <>
              <ImageGrid images={igHits} selected={selectedKeys} onToggle={toggle} library={libraryActions} />
              {igToken ? (
                <button type="button" onClick={() => void loadInstagram(true)} disabled={loading} className="self-center rounded-lg border px-4 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
                  {loading ? "Loading..." : "Load more posts (1 credit)"}
                </button>
              ) : null}
            </>
          ) : !loading && !profile ? (
            <EmptyState title="Browse an Instagram profile" body="Enter a public account to see its recent posts and pick images to crop and download." />
          ) : null}
        </section>
      ) : source === "generate" ? (
        projectId ? (
          <GeneratePanel
            projectId={projectId}
            selected={selectedKeys}
            onToggle={toggle}
            mockMode={mock?.generate ?? false}
            defaultModel={defaultModel}
            onGenerated={(made) => {
              setSelection((s) => [...s, ...made.filter((m) => !s.some((x) => x.key === m.key))]);
              void loadLibrary(projectId);
            }}
          />
        ) : null
      ) : projectId ? (
        <LibraryPanel projectId={projectId} items={library} selected={selectedKeys} onToggle={toggle} onDelete={(id) => void deleteLibraryItem(id)} />
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm" role="status" style={{ color: "var(--text-secondary)" }}>
          {notice}{" "}
          <button type="button" onClick={() => setNotice(null)} className="underline" style={{ color: "var(--text-muted)" }}>
            Dismiss
          </button>
        </p>
      ) : null}

      {selection.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", boxShadow: "0 -4px 16px rgba(0,0,0,0.08)" }}>
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-end gap-2 sm:gap-3">
            <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:flex">
              {selection.map((s) => (
                // eslint-disable-next-line @next/next/no-img-element -- selection thumbnails
                <img key={s.key} src={s.thumb} alt="" referrerPolicy="no-referrer" title={s.title} className="h-10 w-10 shrink-0 rounded object-cover" />
              ))}
            </div>
            <span className="mr-auto text-sm whitespace-nowrap sm:mr-0" style={{ color: "var(--text-secondary)" }}>
              {selection.length} selected
            </span>
            <button type="button" onClick={() => setSelection([])} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
              Clear
            </button>
            {unsavedSelection.length > 0 ? (
              <button
                type="button"
                onClick={() => void saveToLibrary(unsavedSelection)}
                disabled={!projectId || unsavedSelection.every((s) => saving.has(s.src))}
                className="rounded-lg border px-3 py-2 text-sm font-medium whitespace-nowrap disabled:opacity-50"
                style={{ borderColor: "var(--series-1)", color: "var(--series-1)" }}
                title="Keep the original images in this project's library (no SerpApi credits)"
              >
                {unsavedSelection.some((s) => saving.has(s.src)) ? "Saving..." : `Save ${unsavedSelection.length} to library`}
              </button>
            ) : null}
            <button type="button" onClick={() => setStudioOpen(true)} disabled={!projectId} className="rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap text-white disabled:opacity-50" style={{ background: "var(--series-1)" }}>
              Crop &amp; download
            </button>
          </div>
        </div>
      ) : null}

      {studioOpen && projectId ? (
        <CropStudio
          images={selection}
          projectId={projectId}
          onClose={() => setStudioOpen(false)}
          onSaved={() => void loadLibrary(projectId)}
        />
      ) : null}
    </div>
  );
}
