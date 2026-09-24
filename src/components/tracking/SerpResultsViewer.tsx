"use client";

import { Fragment, useState } from "react";
import type { KeywordDailySnapshot, TrackedBrand } from "@/lib/tracking/types";

interface SerpResultsViewerProps {
  keyword: string;
  snapshot: KeywordDailySnapshot | null;
  brand: TrackedBrand;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, brand: TrackedBrand) {
  const terms = [brand.name, ...brand.aliases].filter(Boolean);
  if (terms.length === 0 || !text) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    const isBrand = terms.some((t) => t.toLowerCase() === part.toLowerCase());
    if (!isBrand) return <Fragment key={i}>{part}</Fragment>;
    return (
      <mark
        key={i}
        className="rounded px-0.5 font-semibold"
        style={{ background: "color-mix(in srgb, var(--series-1) 22%, transparent)", color: "var(--text-primary)" }}
      >
        {part}
      </mark>
    );
  });
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1L9.4 5.6L14 7L9.4 8.4L8 13L6.6 8.4L2 7L6.6 5.6L8 1Z"
        fill="var(--series-1)"
      />
    </svg>
  );
}

export function SerpResultsViewer({ keyword, snapshot, brand }: SerpResultsViewerProps) {
  const [view, setView] = useState<"search" | "ai-mode">("search");

  if (!snapshot) {
    return (
      <div
        className="rounded-lg border p-6 text-center text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-muted)" }}
      >
        No snapshot yet for this keyword. Run tracking to capture one.
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex w-full max-w-sm flex-col gap-3 rounded-2xl border p-3 shadow-sm"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
        <span>Search result preview - {snapshot.date}</span>
        {snapshot.error ? <span style={{ color: "var(--status-critical)" }}>error</span> : null}
      </div>

      <div
        className="flex items-center gap-2 rounded-full border px-3 py-2 text-sm"
        style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="10" cy="10" r="6.5" stroke="var(--text-muted)" strokeWidth="2" />
          <line x1="15" y1="15" x2="20" y2="20" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="truncate">{keyword}</span>
      </div>

      <div className="flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setView("search")}
          className="rounded-full px-2.5 py-1"
          style={{
            color: view === "search" ? "var(--text-primary)" : "var(--text-muted)",
            background: view === "search" ? "var(--gridline)" : "transparent",
          }}
        >
          Search + AI Overview
        </button>
        <button
          type="button"
          onClick={() => setView("ai-mode")}
          className="rounded-full px-2.5 py-1"
          style={{
            color: view === "ai-mode" ? "var(--text-primary)" : "var(--text-muted)",
            background: view === "ai-mode" ? "var(--gridline)" : "transparent",
          }}
        >
          AI Mode
        </button>
      </div>

      {view === "search" ? (
        <div className="flex flex-col gap-3">
          {snapshot.aiOverview.present ? (
            <div
              className="flex flex-col gap-2 rounded-xl border p-3"
              style={{
                borderColor: "var(--border-hairline)",
                background: "color-mix(in srgb, var(--series-1) 6%, var(--surface-1))",
              }}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                <SparkleIcon />
                AI Overview
                {snapshot.brandHit.aiOverview.matched ? (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: "var(--status-good)", color: "white" }}
                  >
                    your brand cited
                  </span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {highlight(snapshot.aiOverview.text ?? "", brand)}
              </p>
              {snapshot.aiOverview.sources.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {snapshot.aiOverview.sources.slice(0, 6).map((s, i) => (
                    <span
                      key={i}
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                    >
                      {s.domain || s.title}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No AI Overview shown for this query.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {snapshot.organicResults.map((r) => {
              const isBrandRow = snapshot.brandHit.organic.matched && snapshot.brandHit.organic.organicPosition === r.position;
              return (
                <div key={r.position} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <span
                      aria-hidden
                      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ background: "var(--de-emphasis)" }}
                    />
                    <span className="truncate">{r.domain}</span>
                    {isBrandRow ? (
                      <span
                        className="rounded-full px-1.5 py-0 text-[9px] font-semibold"
                        style={{ background: "var(--status-good)", color: "white" }}
                      >
                        your brand - #{r.position}
                      </span>
                    ) : null}
                  </div>
                  <a className="text-sm font-medium" style={{ color: "#1a73e8" }}>
                    {highlight(r.title, brand)}
                  </a>
                  <p className="text-xs leading-snug" style={{ color: "var(--text-secondary)" }}>
                    {highlight(r.snippet, brand)}
                  </p>
                </div>
              );
            })}
            {snapshot.organicResults.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                No organic results captured.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            <SparkleIcon />
            AI Mode
            {snapshot.brandHit.aiMode.matched ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: "var(--status-good)", color: "white" }}
              >
                your brand cited
              </span>
            ) : null}
          </div>
          {snapshot.aiMode.present ? (
            <>
              <p className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {highlight(snapshot.aiMode.text ?? "", brand)}
              </p>
              {snapshot.aiMode.sources.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {snapshot.aiMode.sources.slice(0, 8).map((s, i) => (
                    <span
                      key={i}
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}
                    >
                      {s.domain || s.title}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No AI Mode answer captured for this query.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
