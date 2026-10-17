"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlanField, SheetPreview } from "@/lib/articles/types";
import { normHeaderText } from "@/lib/content/text";
import { guessStage, PLACEHOLDERS, STAGES, type ContentBoard, type ContentPlanConfig, type Stage, type StatusMap } from "@/lib/content/types";
import { Panel, Switch } from "@/components/tracking/ui";
import { Field, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "@/components/articles/shared";
import type { GoogleStatus } from "@/components/articles/ImportDialog";
import { MappingGrid, SheetLocator, matchedCount, FIELD_LABELS } from "./PlanMapper";

const inputClass = "w-full rounded-lg border px-3 py-1.5 text-sm outline-none";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border-hairline)" }}>
      <h4 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white" style={{ background: "var(--series-1)" }}>
          {n}
        </span>
        {title}
      </h4>
      {children}
    </div>
  );
}

/**
 * One-time setup of a project's content plan: which Sheet, tab and header row; which column is which; what each
 * status value means on the board; and where Docs are created (Drive folder, template) and who reviews them.
 */
export function PlanSetup({
  projectId,
  config,
  google,
  onSaved,
}: {
  projectId: string;
  config: ContentPlanConfig | null;
  google: GoogleStatus | null;
  onSaved: (config: ContentPlanConfig, board: ContentBoard | null) => void;
}) {
  const [url, setUrl] = useState(config?.sheetUrl ?? "");
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [mapping, setMapping] = useState<Record<PlanField, number> | null>(config?.mapping ?? null);
  const [statusMap, setStatusMap] = useState<StatusMap>(config?.statusMap ?? {});
  const [stageValues, setStageValues] = useState<Partial<Record<Stage, string>>>(config?.stageValues ?? {});
  const [folderUrl, setFolderUrl] = useState(config?.drive.folderUrl ?? "");
  const [templateUrl, setTemplateUrl] = useState(config?.drive.templateUrl ?? "");
  const [docName, setDocName] = useState(config?.drive.docName ?? "{{title}}");
  const [emails, setEmails] = useState((config?.clientEmails ?? []).join(", "));
  const [writeDocLinks, setWriteDocLinks] = useState(config?.writeBack.docLinks ?? true);
  const [writeStatus, setWriteStatus] = useState(config?.writeBack.status ?? true);
  const [shareOnClient, setShareOnClient] = useState(config?.shareOnClientReview ?? false);
  const [loading, setLoading] = useState(Boolean(config));
  const [saving, setSaving] = useState(false);
  const [mappedBy, setMappedBy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ warnings: string[]; at: string } | null>(null);

  async function read(sheetUrl: string, tab?: string, headerRow?: number): Promise<SheetPreview> {
    const params = new URLSearchParams({ url: sheetUrl.trim(), ...(tab ? { tab } : {}), ...(headerRow ? { headerRow: String(headerRow) } : {}) });
    const res = await fetch(`/api/articles/sheet?${params}`);
    const data = (await res.json()) as SheetPreview & { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Couldn't read the sheet");
    return data;
  }

  // The saved plan opens as it was set up (its tab, header row and mapping).
  useEffect(() => {
    if (!config) return;
    read(config.sheetUrl, config.tab, config.headerRow)
      .then(setPreview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't read the sheet"))
      .finally(() => setLoading(false));
    // Runs once per project (the component is keyed by project).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(tab?: string, headerRow?: number, sheetUrl = url) {
    setLoading(true);
    setError(null);
    setSaved(null);
    try {
      const data = await read(sheetUrl, tab, headerRow);
      setPreview(data);
      setMapping(data.mapping);
      setMappedBy("detected from the headers");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the sheet");
    } finally {
      setLoading(false);
    }
  }

  async function suggest() {
    if (!preview) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/automap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), tab: preview.tab, headerRow: preview.headerRow }),
      });
      const data = (await res.json()) as { preview?: SheetPreview; mapping?: Record<PlanField, number>; statusMap?: StatusMap; by?: string; error?: string };
      if (!res.ok || !data.mapping) throw new Error(data.error ?? "Couldn't suggest a mapping");
      if (data.preview) setPreview(data.preview);
      setMapping(data.mapping);
      setStatusMap((m) => ({ ...m, ...data.statusMap }));
      setMappedBy(data.by === "ai" ? "suggested by ChatGPT - check it" : "detected from the headers (no OpenAI key)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't suggest a mapping");
    } finally {
      setLoading(false);
    }
  }

  // Each distinct value in the Status column, with how many rows use it.
  const statuses = useMemo(() => {
    if (!preview || !mapping || mapping.status < 0) return [];
    const counts = new Map<string, { value: string; count: number }>();
    for (const row of preview.rows) {
      const value = (row.cells[mapping.status] ?? "").trim();
      const key = normHeaderText(value);
      const e = counts.get(key) ?? { value, count: 0 };
      e.count++;
      counts.set(key, e);
    }
    return [...counts.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
  }, [preview, mapping]);

  const stageOf = (key: string, value: string): Stage => statusMap[key] ?? guessStage(value) ?? "brief";

  async function save() {
    if (!preview || !mapping) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    const fullStatusMap: StatusMap = { ...statusMap };
    for (const s of statuses) fullStatusMap[s.key] = stageOf(s.key, s.value);
    try {
      const res = await fetch("/api/content/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: projectId,
          config: {
            sheetUrl: url.trim(),
            tab: preview.tab,
            headerRow: preview.headerRow,
            mapping,
            statusMap: fullStatusMap,
            stageValues,
            drive: { folderUrl, templateUrl, docName },
            clientEmails: emails,
            writeBack: { docLinks: writeDocLinks, status: writeStatus },
            shareOnClientReview: shareOnClient,
          },
        }),
      });
      const data = (await res.json()) as { config?: ContentPlanConfig; board?: ContentBoard | null; warnings?: string[]; error?: string };
      if (!res.ok || !data.config) throw new Error(data.error ?? data.warnings?.join(" ") ?? "Couldn't save");
      setSaved({ warnings: data.warnings ?? [], at: new Date().toLocaleTimeString() });
      onSaved(data.config, data.board ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const isSample = url.trim() === "sample";
  const canWrite = google?.signedIn && google.canWrite;

  return (
    <Panel title="Content plan" subtitle="set up once per project: board, Docs and write-back use it">
      <div className="flex flex-col gap-5">
        <Step n={1} title="Content plan Sheet">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <div className="min-w-[260px] flex-1">
              <Field label="Google Sheets link" hint="Paste the link from the browser. Any tab works - the plan tab is detected, or pick it below.">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className={inputClass} style={fieldStyle} />
              </Field>
            </div>
            <button type="submit" disabled={loading || !url.trim()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              {loading ? "Reading..." : preview ? "Reload" : "Load sheet"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setUrl("sample");
                void load(undefined, undefined, "sample");
              }}
              className="text-xs underline"
              style={{ color: "var(--text-muted)" }}
            >
              Try the sample plan
            </button>
          </form>
          {preview ? (
            <>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                <b style={{ color: "var(--text-primary)" }}>{preview.title}</b> · {preview.rows.length} article rows ·{" "}
                {preview.via === "google" ? "read with your Google account" : preview.via === "public" ? "read via public link" : "sample data"}
              </p>
              <SheetLocator preview={preview} disabled={loading} onReload={(tab, headerRow) => void load(tab, headerRow)} />
            </>
          ) : null}
        </Step>

        {preview && mapping ? (
          <>
            <Step n={2} title={`Columns (${matchedCount(mapping)} of ${FIELD_LABELS.length} found)`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {mappedBy ? `Mapping ${mappedBy}. ` : ""}Fields this plan doesn&apos;t have can stay empty. A Doc column is added to the plan when you create the first Doc, if there isn&apos;t one.
                </p>
                <button type="button" disabled={loading} onClick={() => void suggest()} className={buttonSecondary} style={secondaryStyle}>
                  ✦ Suggest with AI
                </button>
              </div>
              <MappingGrid preview={preview} mapping={mapping} onChange={setMapping} />
            </Step>

            <Step n={3} title="Status → board stage">
              {mapping.status < 0 ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  No Status column is mapped: every article starts in Brief (or Draft once it has a Doc), and stages are kept on the board.
                </p>
              ) : (
                <>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    What each value in the &quot;{preview.headers[mapping.status]}&quot; column means on the board.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {statuses.map((s) => (
                      <label key={s.key} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
                        <span className="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                          {s.value || <i style={{ color: "var(--text-muted)" }}>(empty)</i>} <span style={{ color: "var(--text-muted)" }}>×{s.count}</span>
                        </span>
                        <select
                          value={stageOf(s.key, s.value)}
                          onChange={(e) => setStatusMap({ ...statusMap, [s.key]: e.target.value as Stage })}
                          className="rounded-md border px-2 py-1 text-xs"
                          style={fieldStyle}
                          aria-label={`Stage for ${s.value || "empty status"}`}
                        >
                          {STAGES.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                      Text written to the plan when a card moves (optional)
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      {STAGES.map((st) => (
                        <Field key={st.id} label={st.label}>
                          <input
                            value={stageValues[st.id] ?? ""}
                            placeholder={st.label}
                            onChange={(e) => setStageValues({ ...stageValues, [st.id]: e.target.value })}
                            className="w-full rounded-md border px-2 py-1 text-xs"
                            style={fieldStyle}
                          />
                        </Field>
                      ))}
                    </div>
                  </details>
                </>
              )}
            </Step>

            <Step n={4} title="Google Drive & client review">
              {!isSample && !canWrite ? (
                <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-secondary)" }}>
                  {!google?.configured
                    ? "Creating Docs and writing to the plan needs Google sign-in, which isn't set up on the server yet (steps below under Google Sheets & Docs). You can still save the plan and use the board."
                    : !google.signedIn
                      ? "Sign in with Google (below) to create Docs in this folder and write links and statuses to the plan."
                      : "Sign in with Google again (below) to allow creating Docs and editing the plan - your current sign-in only reads."}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Project's Drive folder" hint={config?.drive.folderName ? `✓ ${config.drive.folderName}` : "New Docs are created here (shared drives work too)."}>
                  <input value={folderUrl} onChange={(e) => setFolderUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." className={inputClass} style={fieldStyle} />
                </Field>
                <Field label="Template Doc (optional)" hint={<>Copied for each article, with {PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ")} filled in. Without one, each Doc gets a brief.</>}>
                  <input value={templateUrl} onChange={(e) => setTemplateUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..." className={inputClass} style={fieldStyle} />
                </Field>
                <Field label="Doc name" hint="Same placeholders, e.g. {{project}} - {{title}}">
                  <input value={docName} onChange={(e) => setDocName(e.target.value)} className={inputClass} style={fieldStyle} />
                </Field>
                <Field label="Client emails" hint="Get comment access when a Doc is shared for review. Comma-separated.">
                  <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="marketing@client.com" className={inputClass} style={fieldStyle} />
                </Field>
              </div>
              <div className="flex flex-col gap-2">
                <Switch checked={writeDocLinks} onChange={setWriteDocLinks} label="Write each new Doc's link into the plan" />
                <Switch checked={writeStatus} onChange={setWriteStatus} label="Write the status into the plan when a card moves" />
                <Switch checked={shareOnClient} onChange={setShareOnClient} label="Share the Doc with the client emails when its card moves to Client review" />
              </div>
            </Step>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4" style={{ borderColor: "var(--border-hairline)" }}>
              {saved ? (
                <span className="mr-auto text-xs" style={{ color: saved.warnings.length ? "var(--status-critical)" : "var(--success-text)" }}>
                  {saved.warnings.length ? saved.warnings.join(" ") : `✓ Saved and synced at ${saved.at}`}
                </span>
              ) : null}
              <button type="button" disabled={saving || loading || (mapping.title < 0 && mapping.focusKeyword < 0)} onClick={() => void save()} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
                {saving ? "Saving..." : "Save & sync board"}
              </button>
            </div>
          </>
        ) : null}
        {error ? (
          <p className="text-sm" role="alert" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
