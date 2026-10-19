"use client";

import type { SyncSummary } from "@/lib/google/docSync";
import { Modal, buttonPrimary, buttonSecondary, secondaryStyle } from "./shared";

export interface PushPreview {
  summary: SyncSummary;
  /** Set when the Doc was edited after it was imported: those parts would be set back to the article's text. */
  conflict: string | null;
  simulated?: boolean;
}

/** What "Update Doc" is about to change in the Google Doc, before anything is written. */
export function PushDialog({ preview, busy, error, onConfirm, onReimport, onClose }: { preview: PushPreview; busy: boolean; error: string | null; onConfirm: () => void; onReimport: () => void; onClose: () => void }) {
  const { summary, conflict } = preview;
  const nothing = summary.unchanged;
  return (
    <Modal
      title="Update the Google Doc"
      onClose={busy ? () => undefined : onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={buttonSecondary} style={secondaryStyle}>
            {nothing ? "Close" : "Cancel"}
          </button>
          {!nothing && conflict ? (
            <button type="button" onClick={onReimport} disabled={busy} className={buttonSecondary} style={secondaryStyle}>
              Re-import the Doc first
            </button>
          ) : null}
          {!nothing ? (
            <button type="button" onClick={onConfirm} disabled={busy} className={buttonPrimary} style={{ background: conflict ? "var(--status-critical)" : "var(--series-1)" }}>
              {busy ? "Updating..." : conflict ? "Update anyway" : "Update the Doc"}
            </button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {nothing ? (
          <p style={{ color: "var(--text-secondary)" }}>The Doc already has this article&apos;s text and formatting. Nothing to update.</p>
        ) : (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            The Doc is edited <b>in place</b>: only the changes below are made. Its layout, fonts, colours, table styling, comments and version history are kept
            {preview.simulated ? " (sample article: nothing is actually sent to Google)." : "."}
          </p>
        )}

        {conflict ? (
          <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }} role="alert">
            {conflict}
          </p>
        ) : null}

        <Section title={`Text changed (${summary.edits.length})`} show={summary.edits.length > 0}>
          {summary.edits.slice(0, 12).map((e, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="line-through" style={{ color: "var(--text-muted)" }}>
                {e.before}
              </span>
              <span style={{ color: "var(--text-primary)" }}>{e.after}</span>
            </li>
          ))}
          {summary.edits.length > 12 ? <li style={{ color: "var(--text-muted)" }}>and {summary.edits.length - 12} more</li> : null}
        </Section>

        <Section title={`Paragraphs added (${summary.added.length})`} show={summary.added.length > 0}>
          {summary.added.slice(0, 8).map((t, i) => (
            <li key={i} style={{ color: "var(--success-text)" }}>
              + {t}
            </li>
          ))}
          {summary.added.length > 8 ? <li style={{ color: "var(--text-muted)" }}>and {summary.added.length - 8} more</li> : null}
        </Section>

        <Section title={`Paragraphs removed (${summary.removed.length})`} show={summary.removed.length > 0}>
          {summary.removed.slice(0, 8).map((t, i) => (
            <li key={i} className="line-through" style={{ color: "var(--status-critical)" }}>
              {t}
            </li>
          ))}
          {summary.removed.length > 8 ? <li style={{ color: "var(--text-muted)" }}>and {summary.removed.length - 8} more</li> : null}
        </Section>

        {summary.headings || summary.marks ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Formatting: {summary.headings ? `${summary.headings} heading${summary.headings === 1 ? "" : "s"} changed` : ""}
            {summary.headings && summary.marks ? ", " : ""}
            {summary.marks ? `${summary.marks} bold / italic / underline / link change${summary.marks === 1 ? "" : "s"}` : ""}.
          </p>
        ) : null}

        {summary.skipped.length ? (
          <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {summary.skipped.map((t, i) => (
              <li key={i}>Not synced: {t}</li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p role="alert" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function Section({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h4>
      <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-lg border p-2.5 text-xs" style={{ borderColor: "var(--border-hairline)" }}>
        {children}
      </ul>
    </section>
  );
}
