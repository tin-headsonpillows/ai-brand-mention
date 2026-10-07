"use client";

import { useState } from "react";
import type { PlanField, SheetPreview } from "@/lib/articles/types";
import { Segmented, Switch } from "@/components/tracking/ui";
import { Field, Modal, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

export interface GoogleStatus {
  configured: boolean;
  signedIn: boolean;
  email?: string;
}

const FIELDS: Array<{ field: PlanField; label: string; required?: boolean }> = [
  { field: "title", label: "Title" },
  { field: "docUrl", label: "Google Doc link" },
  { field: "focusKeyword", label: "Focus keyword" },
  { field: "secondaryKeywords", label: "Secondary keywords" },
  { field: "slug", label: "Slug" },
  { field: "metaTitle", label: "SEO title" },
  { field: "metaDescription", label: "Meta description" },
  { field: "categories", label: "Categories" },
  { field: "tags", label: "Tags" },
  { field: "publishDate", label: "Publish date" },
  { field: "status", label: "Status / notes" },
];

type Result = { title: string; status: "created" | "updated" | "skipped" | "failed"; error?: string };
const CHUNK = 3;

/**
 * Imports articles: a content-plan Sheet (one row per article, with a link to its Google Doc) or a single Doc.
 * Rows are imported a few at a time so long plans show progress and stay inside the server's time limit.
 */
export function ImportDialog({
  projectId,
  google,
  initialUrl,
  onClose,
  onImported,
}: {
  projectId: string;
  google: GoogleStatus | null;
  initialUrl?: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<"sheet" | "doc">("sheet");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [docUrl, setDocUrl] = useState("");
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [mapping, setMapping] = useState<Record<PlanField, number> | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadSheet(tab?: string, sheetUrl = url) {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const params = new URLSearchParams({ url: sheetUrl.trim(), ...(tab ? { tab } : {}) });
      const res = await fetch(`/api/articles/sheet?${params}`);
      const data = (await res.json()) as SheetPreview & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't read the sheet");
      setPreview(data);
      setMapping(data.mapping);
      const cellOf = (row: SheetPreview["rows"][number], field: PlanField) => (data.mapping[field] >= 0 ? row.cells[data.mapping[field]] : "");
      setSelected(new Set(data.rows.filter((r) => cellOf(r, "title") || cellOf(r, "docUrl")).map((r) => r.rowNumber)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the sheet");
    } finally {
      setLoading(false);
    }
  }

  const value = (row: SheetPreview["rows"][number], field: PlanField): string => {
    const col = mapping?.[field] ?? -1;
    if (col < 0) return "";
    if (field === "docUrl") return row.links[col] ?? (/^https?:\/\//.test(row.cells[col]) || row.cells[col].startsWith("sample:") ? row.cells[col] : "");
    return row.cells[col] ?? "";
  };

  async function runImport(items: Array<Record<string, unknown>>) {
    setLoading(true);
    setError(null);
    setResults([]);
    setProgress({ done: 0, total: items.length });
    const all: Result[] = [];
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        const res = await fetch("/api/articles/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: projectId, overwrite, items: items.slice(i, i + CHUNK) }),
        });
        const data = (await res.json().catch(() => ({}))) as { results?: Result[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
        all.push(...(data.results ?? []));
        setResults([...all]);
        setProgress({ done: Math.min(items.length, i + CHUNK), total: items.length });
      }
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  function importRows() {
    if (!preview) return;
    const rows = preview.rows.filter((r) => selected.has(r.rowNumber));
    void runImport(
      rows.map((r) => ({
        rowNumber: r.rowNumber,
        sheetId: preview.spreadsheetId,
        sheetTab: preview.tab,
        ...Object.fromEntries(FIELDS.map(({ field }) => [field, value(r, field)])),
      }))
    );
  }

  const created = results.filter((r) => r.status === "created" || r.status === "updated").length;
  const signedIn = google?.signedIn;

  return (
    <Modal
      title="Import articles from Google"
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          {results.length && !loading ? (
            <span className="mr-auto text-xs" style={{ color: "var(--text-secondary)" }}>
              {created} imported · {results.filter((r) => r.status === "skipped").length} skipped · {results.filter((r) => r.status === "failed").length} failed
            </span>
          ) : null}
          <button type="button" onClick={onClose} className={buttonSecondary} style={secondaryStyle}>
            {results.length && !loading ? "Done" : "Cancel"}
          </button>
          {mode === "sheet" ? (
            <button type="button" disabled={loading || !preview || selected.size === 0} onClick={importRows} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              {loading && progress ? `Importing ${progress.done}/${progress.total}...` : `Import ${selected.size} article${selected.size === 1 ? "" : "s"}`}
            </button>
          ) : (
            <button type="button" disabled={loading || !docUrl.trim()} onClick={() => void runImport([{ docUrl: docUrl.trim() }])} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              {loading ? "Importing..." : "Import Doc"}
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-secondary)" }}>
          {signedIn ? (
            <span>
              Reading as <b>{google?.email ?? "your Google account"}</b> - private Sheets and Docs you can open work.
            </span>
          ) : google?.configured ? (
            <span>
              Sign in with Google to read private Sheets and Docs. Without signing in, only files shared as &quot;Anyone with the link&quot; can be read.
            </span>
          ) : (
            <span>
              Google sign-in isn&apos;t set up on the server yet, so only files shared as &quot;Anyone with the link&quot; can be read. Setup steps are in Settings.
            </span>
          )}
          {!signedIn && google?.configured ? (
            <a href={`/api/google/auth?returnTo=${encodeURIComponent("/articles?import=1")}`} className="rounded-md border px-3 py-1 font-medium" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)", background: "var(--surface-1)" }}>
              Sign in with Google
            </a>
          ) : null}
        </div>

        <Segmented
          value={mode}
          options={[
            { value: "sheet", label: "Content plan (Google Sheet)" },
            { value: "doc", label: "Single Google Doc" },
          ]}
          onChange={(m) => {
            setMode(m);
            setError(null);
            setResults([]);
          }}
          ariaLabel="Import type"
        />

        {mode === "doc" ? (
          <Field label="Google Doc link" hint="The Doc's Title (or first Heading 1) becomes the post title; other headings become H2/H3. Images are copied to the project library.">
            <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..." className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
          </Field>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadSheet();
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <div className="min-w-[280px] flex-1">
                <Field label="Content plan Sheet link" hint="One row per article with a column linking to its Google Doc. Headers like Title, Focus keyword, Doc, Category, Tags, Publish date are recognised.">
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} />
                </Field>
              </div>
              <button type="submit" disabled={loading || !url.trim()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
                {loading && !progress ? "Reading..." : "Load sheet"}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setUrl("sample");
                  void loadSheet(undefined, "sample");
                }}
                className="text-xs underline"
                style={{ color: "var(--text-muted)" }}
              >
                Use the sample plan
              </button>
            </form>

            {preview && mapping ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <b style={{ color: "var(--text-primary)" }}>{preview.title}</b>
                  {preview.tabs.length > 1 ? (
                    <select value={preview.tab} onChange={(e) => void loadSheet(e.target.value)} className="rounded-md border px-2 py-1 text-xs" style={fieldStyle} aria-label="Sheet tab">
                      {preview.tabs.map((t) => (
                        <option key={t.gid} value={t.title}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{preview.tab}</span>
                  )}
                  <span>
                    {preview.rows.length} rows · read {preview.via === "google" ? "with your Google account" : preview.via === "public" ? "via public link (cell links not available)" : "from sample data"}
                  </span>
                </div>

                <details className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border-hairline)" }} open={mapping.title < 0 && mapping.docUrl < 0}>
                  <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    Column mapping ({FIELDS.filter((f) => mapping[f.field] >= 0).length} of {FIELDS.length} matched)
                  </summary>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {FIELDS.map(({ field, label }) => (
                      <Field key={field} label={label}>
                        <select
                          value={mapping[field]}
                          onChange={(e) => setMapping({ ...mapping, [field]: Number(e.target.value) })}
                          className="rounded-md border px-2 py-1 text-xs"
                          style={fieldStyle}
                        >
                          <option value={-1}>(none)</option>
                          {preview.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ))}
                  </div>
                </details>

                <div className="flex items-center justify-between gap-3">
                  <Switch checked={overwrite} onChange={setOverwrite} label="Update articles imported before (replaces their body)" />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {selected.size} of {preview.rows.length} selected
                  </span>
                </div>

                <div className="max-h-[42vh] overflow-auto rounded-lg border" style={{ borderColor: "var(--border-hairline)" }}>
                  <table className="w-full min-w-[640px] text-xs">
                    <thead className="sticky top-0" style={{ background: "var(--page-plane)" }}>
                      <tr className="text-left" style={{ color: "var(--text-muted)" }}>
                        <th className="w-8 px-2 py-2">
                          <input
                            type="checkbox"
                            aria-label="Select all rows"
                            checked={selected.size === preview.rows.length}
                            onChange={(e) => setSelected(e.target.checked ? new Set(preview.rows.map((r) => r.rowNumber)) : new Set())}
                          />
                        </th>
                        <th className="px-2 py-2 font-medium">Row</th>
                        <th className="px-2 py-2 font-medium">Title</th>
                        <th className="px-2 py-2 font-medium">Focus keyword</th>
                        <th className="px-2 py-2 font-medium">Doc</th>
                        <th className="px-2 py-2 font-medium">Publish date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => {
                        const doc = value(r, "docUrl");
                        const result = results.find((x) => x.title === (value(r, "title") || doc));
                        return (
                          <tr key={r.rowNumber} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                aria-label={`Select row ${r.rowNumber}`}
                                checked={selected.has(r.rowNumber)}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(r.rowNumber);
                                  else next.delete(r.rowNumber);
                                  setSelected(next);
                                }}
                              />
                            </td>
                            <td className="tabular px-2 py-1.5" style={{ color: "var(--text-muted)" }}>
                              {r.rowNumber}
                            </td>
                            <td className="max-w-[280px] truncate px-2 py-1.5" style={{ color: "var(--text-primary)" }}>
                              {value(r, "title") || <span style={{ color: "var(--text-muted)" }}>(from the Doc)</span>}
                              {result ? (
                                <span className="ml-2" style={{ color: result.status === "failed" ? "var(--status-critical)" : "var(--text-muted)" }}>
                                  · {result.status}
                                  {result.error && result.status !== "skipped" ? `: ${result.error}` : ""}
                                </span>
                              ) : null}
                            </td>
                            <td className="max-w-[180px] truncate px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>
                              {value(r, "focusKeyword")}
                            </td>
                            <td className="px-2 py-1.5">
                              {doc ? <span style={{ color: "var(--success-text)" }}>✓ linked</span> : <span style={{ color: "var(--text-muted)" }}>no Doc - imported empty</span>}
                            </td>
                            <td className="px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>
                              {value(r, "publishDate")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}

        {mode === "doc" && results.length ? (
          <p className="text-sm" style={{ color: results[0].status === "failed" ? "var(--status-critical)" : "var(--text-secondary)" }}>
            {results[0].status === "failed" ? results[0].error : `${results[0].title}: ${results[0].status}${results[0].error ? ` (${results[0].error})` : ""}`}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
