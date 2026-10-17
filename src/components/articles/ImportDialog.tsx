"use client";

import { useEffect, useState } from "react";
import type { PlanField, SheetPreview } from "@/lib/articles/types";
import type { ContentPlanConfig } from "@/lib/content/types";
import { Segmented, Switch } from "@/components/tracking/ui";
import { FIELD_LABELS, MappingGrid, SheetLocator, matchedCount, planValue } from "@/components/content/PlanMapper";
import { Field, Modal, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

export interface GoogleStatus {
  configured: boolean;
  signedIn: boolean;
  email?: string;
  /** Granted access to create Docs and edit plans (sign-ins from before that was added only read). */
  canWrite?: boolean;
}

async function fetchPreview(url: string, tab?: string, headerRow?: number): Promise<SheetPreview> {
  const params = new URLSearchParams({ url: url.trim(), ...(tab ? { tab } : {}), ...(headerRow ? { headerRow: String(headerRow) } : {}) });
  const res = await fetch(`/api/articles/sheet?${params}`);
  const data = (await res.json()) as SheetPreview & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Couldn't read the sheet");
  return data;
}

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
  plan,
  onClose,
  onImported,
}: {
  projectId: string;
  google: GoogleStatus | null;
  initialUrl?: string;
  /** The project's saved content plan: opens on its tab with its column mapping. */
  plan?: ContentPlanConfig | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<"sheet" | "doc">("sheet");
  const [url, setUrl] = useState(initialUrl ?? plan?.sheetUrl ?? "");
  const [docUrl, setDocUrl] = useState("");
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [mapping, setMapping] = useState<Record<PlanField, number> | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [loading, setLoading] = useState(Boolean(!initialUrl && plan));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [usingSaved, setUsingSaved] = useState(false);

  function apply(data: SheetPreview, saved: boolean) {
    const map = saved && plan ? plan.mapping : data.mapping;
    setPreview(data);
    setMapping(map);
    setUsingSaved(saved);
    setSelected(new Set(data.rows.filter((r) => planValue(r, map, "title") || planValue(r, map, "docUrl")).map((r) => r.rowNumber)));
  }

  // Opens on the project's saved plan, with its tab, header row and mapping.
  useEffect(() => {
    if (initialUrl || !plan) return;
    fetchPreview(plan.sheetUrl, plan.tab, plan.headerRow)
      .then((data) => apply(data, data.tab === plan.tab))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't read the sheet"))
      .finally(() => setLoading(false));
    // Runs once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSheet(tab?: string, sheetUrl = url, headerRow?: number) {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const data = await fetchPreview(sheetUrl, tab, headerRow);
      // The saved mapping still applies when re-reading the saved plan's own tab and header row.
      apply(data, Boolean(plan && plan.sheetUrl === sheetUrl.trim() && data.tab === plan.tab && data.headerRow === plan.headerRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the sheet");
    } finally {
      setLoading(false);
    }
  }

  const value = (row: SheetPreview["rows"][number], field: PlanField): string => (mapping ? planValue(row, mapping, field) : "");

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
        ...Object.fromEntries(FIELD_LABELS.map(({ field }) => [field, value(r, field)])),
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
                <Field
                  label="Content plan Sheet link"
                  hint="Any layout: the plan's tab, its header row and each column are detected, and you can change them below. Save a project's plan once in Settings → Content plan to skip this."
                >
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
                  <span>
                    {preview.rows.length} rows · read{" "}
                    {preview.via === "google" ? "with your Google account" : preview.via === "public" ? "via public link (all tabs; sign in for private files)" : "from sample data"}
                  </span>
                  {usingSaved ? <span style={{ color: "var(--success-text)" }}>✓ using the project&apos;s saved mapping</span> : null}
                </div>
                <SheetLocator preview={preview} disabled={loading} onReload={(tab, headerRow) => void loadSheet(tab, url, headerRow)} />

                <details className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border-hairline)" }} open={mapping.title < 0 && mapping.focusKeyword < 0}>
                  <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    Column mapping ({matchedCount(mapping)} of {FIELD_LABELS.length} fields found)
                  </summary>
                  <div className="mt-3">
                    <MappingGrid preview={preview} mapping={mapping} onChange={setMapping} />
                  </div>
                </details>

                <div className="flex items-center justify-between gap-3">
                  <Switch checked={overwrite} onChange={setOverwrite} label="Update articles imported before (replaces their body)" />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {selected.size} of {preview.rows.length} selected
                  </span>
                </div>

                <div className="max-h-[42vh] overflow-auto rounded-lg border" style={{ borderColor: "var(--border-hairline)" }}>
                  <table className="w-full min-w-[720px] text-xs">
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
                        <th className="px-2 py-2 font-medium">Status</th>
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
                            <td className="max-w-[140px] truncate px-2 py-1.5" style={{ color: "var(--text-secondary)" }}>
                              {value(r, "status")}
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
