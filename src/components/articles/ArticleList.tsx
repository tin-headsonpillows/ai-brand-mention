"use client";

import { useState } from "react";
import type { ArticleStatus, ArticleSummary } from "@/lib/articles/types";
import { EmptyState, Segmented } from "@/components/tracking/ui";
import { ScoreBadge, StatusBadge, buttonPrimary, buttonSecondary, fieldStyle, secondaryStyle } from "./shared";

type Filter = "all" | ArticleStatus;

export function ArticleList({
  items,
  onOpen,
  onDelete,
  onNew,
  onImport,
  onSample,
}: {
  items: ArticleSummary[] | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
  onSample: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  if (items === null) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading articles...
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No articles in this project yet"
        body="Import a content plan from Google Sheets (one row per article, with a link to its Google Doc), import a single Doc, or start a blank article."
        action={
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={onImport} className={buttonPrimary} style={{ background: "var(--series-1)" }}>
              Import from Google
            </button>
            <button type="button" onClick={onNew} className={buttonSecondary} style={secondaryStyle}>
              New blank article
            </button>
            <button type="button" onClick={onSample} className={buttonSecondary} style={secondaryStyle}>
              Try with sample articles
            </button>
          </div>
        }
      />
    );
  }

  const counts = items.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {});
  const q = query.trim().toLowerCase();
  const visible = items
    .filter((a) => filter === "all" || a.status === filter)
    .filter((a) => !q || a.title.toLowerCase().includes(q) || a.focusKeyword.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const avg = Math.round(items.reduce((s, a) => s + a.seoScore, 0) / items.length);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Filter>
            value={filter}
            options={[
              { value: "all", label: `All ${items.length}` },
              { value: "draft", label: `Draft ${counts.draft ?? 0}` },
              { value: "ready", label: `Ready ${counts.ready ?? 0}` },
              { value: "scheduled", label: `Scheduled ${counts.scheduled ?? 0}` },
              { value: "published", label: `Published ${counts.published ?? 0}` },
              ...(counts.error ? [{ value: "error" as Filter, label: `Failed ${counts.error}` }] : []),
            ]}
            onChange={setFilter}
            ariaLabel="Filter by status"
          />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title or keyword" className="w-56 rounded-lg border px-3 py-1.5 text-sm outline-none" style={fieldStyle} aria-label="Search articles" />
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Average SEO score {avg}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}>
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs" style={{ color: "var(--text-muted)" }}>
              <th className="px-4 py-2.5 font-medium">Article</th>
              <th className="px-3 py-2.5 font-medium">SEO</th>
              <th className="px-3 py-2.5 text-right font-medium">Words</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="px-3 py-2.5 font-medium">Updated</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.id} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                <td className="max-w-[420px] px-4 py-2.5">
                  <button type="button" onClick={() => onOpen(a.id)} className="block w-full text-left">
                    <span className="block truncate font-medium hover:underline" style={{ color: "var(--text-primary)" }}>
                      {a.title || "Untitled article"}
                    </span>
                    <span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {a.focusKeyword ? `Keyword: ${a.focusKeyword}` : "No focus keyword"}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <ScoreBadge score={a.seoScore} />
                </td>
                <td className="tabular px-3 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                  {a.wordCount.toLocaleString()}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={a.status} wordpress={a.wordpress} />
                  {a.status === "scheduled" && a.publish.date ? (
                    <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {new Date(a.publish.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  ) : null}
                  {a.wordpress?.link ? (
                    <a href={a.wordpress.link} target="_blank" rel="noreferrer" className="block text-[11px] underline" style={{ color: "var(--series-1)" }}>
                      View on site ↗
                    </a>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {a.source.type === "sheet" ? `Sheet row ${a.source.sheetRow ?? "?"}` : a.source.type === "doc" ? "Google Doc" : a.source.type === "sample" ? "Sample" : "Written here"}
                </td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {new Date(a.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => onOpen(a.id)} className="mr-3 text-xs font-medium" style={{ color: "var(--series-1)" }}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete "${a.title || "Untitled article"}" from this app? The WordPress post (if any) is not touched.`)) onDelete(a.id);
                    }}
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  No articles match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
