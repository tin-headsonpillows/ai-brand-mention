"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { FORMAT_LABEL, downloadExport } from "@/lib/export/download";
import type { ExportDoc, ExportFormat, ExportSection } from "@/lib/export/types";

/** Report title and subtitle shared by every export on the page (e.g. the run's prompt and date). */
export interface ExportInfo {
  title: string;
  subtitle: string;
  /** File-name stem, e.g. "ChatGPT Mentions - top beachfront hotel - 2026-10-16". */
  fileStem: string;
}

export const ExportContext = createContext<ExportInfo>({ title: "Export", subtitle: "", fileStem: "export" });

const FORMATS: ExportFormat[] = ["xlsx", "pdf", "pptx"];

/** "Export" button with a menu of Excel / PDF / PowerPoint; the sections are built only when a format is picked. */
export function ExportMenu({
  sections,
  name,
  label = "Export",
  primary = false,
}: {
  sections: () => ExportSection[];
  /** Added to the file name and the report title, e.g. "Leaderboard". */
  name: string;
  label?: string;
  primary?: boolean;
}) {
  const info = useContext(ExportContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(format: ExportFormat) {
    setBusy(format);
    setError(null);
    try {
      const doc: ExportDoc = { title: `${info.title} - ${name}`, subtitle: info.subtitle, sections: sections() };
      await downloadExport(doc, format, `${info.fileStem} - ${name}`);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={primary ? "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" : "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium"}
        style={primary ? { background: "var(--series-1)" } : { borderColor: "var(--border-hairline)", color: "var(--text-primary)", background: "var(--surface-1)" }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" />
        </svg>
        {busy ? "Preparing..." : label}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 flex min-w-44 flex-col rounded-lg border p-1 text-sm shadow-lg"
          style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
        >
          {FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => void run(f)}
              className="rounded-md px-3 py-1.5 text-left hover:bg-[var(--page-plane)] disabled:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              {busy === f ? "Preparing..." : FORMAT_LABEL[f]}
            </button>
          ))}
          {error ? (
            <p className="px-3 py-1 text-xs" style={{ color: "var(--status-critical)" }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
