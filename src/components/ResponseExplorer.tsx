"use client";

import { Fragment, useMemo, useState } from "react";
import type { PromptResult } from "@/lib/types";
import { MentionBadge } from "./MentionBadge";

interface ResponseExplorerProps {
  results: PromptResult[];
  brand: string;
  competitors: string[];
}

type Filter = "all" | "mentioned" | "not-mentioned" | "errors";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, brand: string, competitors: string[]) {
  const terms = [brand, ...competitors].filter(Boolean);
  if (terms.length === 0 || !text) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    const isBrand = part.toLowerCase() === brand.toLowerCase();
    const isCompetitor = competitors.some((c) => c.toLowerCase() === part.toLowerCase());
    if (isBrand || isCompetitor) {
      return (
        <mark
          key={i}
          className="rounded px-0.5 font-semibold"
          style={{
            background: isBrand ? "color-mix(in srgb, var(--series-1) 20%, transparent)" : "var(--gridline)",
            color: "var(--text-primary)",
          }}
        >
          {part}
        </mark>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function ResponseExplorer({ results, brand, competitors }: ResponseExplorerProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    switch (filter) {
      case "mentioned":
        return results.filter((r) => r.brandMentioned);
      case "not-mentioned":
        return results.filter((r) => !r.brandMentioned && !r.error);
      case "errors":
        return results.filter((r) => r.error);
      default:
        return results;
    }
  }, [results, filter]);

  const counts = useMemo(
    () => ({
      all: results.length,
      mentioned: results.filter((r) => r.brandMentioned).length,
      notMentioned: results.filter((r) => !r.brandMentioned && !r.error).length,
      errors: results.filter((r) => r.error).length,
    }),
    [results]
  );

  const filterButtons: Array<{ key: Filter; label: string; count: number }> = [
    { key: "all", label: "All", count: counts.all },
    { key: "mentioned", label: "Mentioned", count: counts.mentioned },
    { key: "not-mentioned", label: "Not mentioned", count: counts.notMentioned },
    ...(counts.errors > 0 ? [{ key: "errors" as Filter, label: "Errors", count: counts.errors }] : []),
  ];

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Prompts &amp; responses
        </h3>
        <div className="flex flex-wrap gap-1 text-xs">
          {filterButtons.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => setFilter(b.key)}
              className="rounded-full px-2.5 py-1"
              style={{
                color: filter === b.key ? "var(--text-primary)" : "var(--text-muted)",
                background: filter === b.key ? "var(--gridline)" : "transparent",
              }}
            >
              {b.label} ({b.count})
            </button>
          ))}
        </div>
      </div>

      <div className="flex max-h-[560px] flex-col divide-y overflow-y-auto" style={{ borderColor: "var(--gridline)" }}>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No results in this filter yet.
          </p>
        ) : (
          filtered.map((r) => (
            <details key={r.index} className="group py-2.5" style={{ borderColor: "var(--gridline)" }}>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>
                  {r.prompt}
                </span>
                {r.error ? (
                  <span className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--status-critical)" }}>
                    Error
                  </span>
                ) : (
                  <span className="whitespace-nowrap">
                    <MentionBadge mentioned={r.brandMentioned} />
                  </span>
                )}
              </summary>
              <div
                className="mt-2 rounded p-3 text-sm whitespace-pre-wrap"
                style={{ background: "var(--page-plane)", color: "var(--text-secondary)" }}
              >
                {r.error ? (
                  <span style={{ color: "var(--status-critical)" }}>{r.error}</span>
                ) : (
                  highlight(r.response, brand, competitors)
                )}
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
