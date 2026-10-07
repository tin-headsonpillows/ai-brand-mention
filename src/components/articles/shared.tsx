"use client";

import { useEffect, type ReactNode } from "react";
import type { ArticleStatus, WordPressLink } from "@/lib/articles/types";

export const fieldStyle: React.CSSProperties = {
  borderColor: "var(--border-hairline)",
  background: "var(--page-plane)",
  color: "var(--text-primary)",
};

export const buttonPrimary = "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
export const buttonSecondary = "rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50";
export const secondaryStyle: React.CSSProperties = { borderColor: "var(--border-hairline)", color: "var(--text-primary)", background: "var(--surface-1)" };

export function Field({ label, hint, children, aside }: { label: string; hint?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        <span>{label}</span>
        {aside}
      </span>
      {children}
      {hint ? (
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** "52 / 60" with the colour of the length check: good inside the range, warning when close, critical outside. */
export function Counter({ value, good, ok }: { value: number; good: [number, number]; ok: [number, number] }) {
  const tone = value >= good[0] && value <= good[1] ? "var(--success-text)" : value >= ok[0] && value <= ok[1] ? "var(--text-secondary)" : "var(--status-critical)";
  return (
    <span className="tabular text-[11px] font-medium" style={{ color: tone }}>
      {value} / {good[1]}
    </span>
  );
}

export function scoreTone(score: number): string {
  return score >= 80 ? "var(--status-good)" : score >= 50 ? "var(--status-warning)" : "var(--status-critical)";
}

export function ScoreBadge({ score, size = "sm" }: { score: number; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? 56 : 32;
  const stroke = size === "lg" ? 5 : 3.5;
  const r = dim / 2 - stroke;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: dim, height: dim }} title={`SEO score ${score} / 100`}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} aria-hidden>
        <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke="var(--gridline)" strokeWidth={stroke} />
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          stroke={scoreTone(score)}
          strokeWidth={stroke}
          strokeDasharray={`${(score / 100) * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${dim / 2} ${dim / 2})`}
        />
      </svg>
      <span className={`absolute tabular font-semibold ${size === "lg" ? "text-base" : "text-[11px]"}`} style={{ color: "var(--text-primary)" }}>
        {score}
      </span>
    </span>
  );
}

const STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  published: "Published",
  scheduled: "Scheduled",
  error: "Publish failed",
};
const STATUS_DOT: Record<ArticleStatus, string> = {
  draft: "var(--text-muted)",
  ready: "var(--series-1)",
  published: "var(--status-good)",
  scheduled: "var(--series-7)",
  error: "var(--status-critical)",
};

export function StatusBadge({ status, wordpress }: { status: ArticleStatus; wordpress?: WordPressLink }) {
  const wpDraft = wordpress && wordpress.status === "draft";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_DOT[status] }} aria-hidden />
      {STATUS_LABEL[status]}
      {wpDraft && status !== "published" && status !== "scheduled" ? <span style={{ color: "var(--text-muted)" }}>· in WP as draft</span> : null}
    </span>
  );
}

export function Modal({ title, onClose, children, width = "max-w-3xl", footer }: { title: string; onClose: () => void; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-xl border`} style={{ background: "var(--surface-1)", borderColor: "var(--border-hairline)" }} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border-hairline)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h3>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm" style={{ color: "var(--text-muted)" }} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)" }}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Comma-separated text <-> list, for keyword/category/tag inputs. */
export const toList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
