"use client";

import type { PlanField, SheetPreview } from "@/lib/articles/types";
import { Field, fieldStyle } from "@/components/articles/shared";

/** Every plan field, grouped the way the mapping grid shows them. */
export const FIELD_LABELS: Array<{ field: PlanField; label: string; group: "Article" | "SEO" | "Workflow" }> = [
  { field: "title", label: "Title", group: "Article" },
  { field: "docUrl", label: "Google Doc link", group: "Article" },
  { field: "focusKeyword", label: "Focus keyword / topic", group: "Article" },
  { field: "categories", label: "Category", group: "Article" },
  { field: "tags", label: "Tags", group: "Article" },
  { field: "secondaryKeywords", label: "Secondary keywords", group: "SEO" },
  { field: "slug", label: "Slug", group: "SEO" },
  { field: "metaTitle", label: "SEO title", group: "SEO" },
  { field: "metaDescription", label: "Meta description", group: "SEO" },
  { field: "status", label: "Status", group: "Workflow" },
  { field: "writer", label: "Writer", group: "Workflow" },
  { field: "dueDate", label: "Due date", group: "Workflow" },
  { field: "publishDate", label: "Publish date / month", group: "Workflow" },
  { field: "priority", label: "Priority", group: "Workflow" },
  { field: "action", label: "Type (new / update)", group: "Workflow" },
  { field: "publishUrl", label: "Published URL", group: "Workflow" },
];

export type Row = SheetPreview["rows"][number];

/** A row's value for a field under a mapping (link fields read the link behind the cell). */
export function planValue(row: Row, mapping: Record<PlanField, number>, field: PlanField): string {
  const col = mapping[field] ?? -1;
  if (col < 0) return "";
  if (field === "docUrl" || field === "publishUrl") {
    const text = row.cells[col] ?? "";
    return row.links[col] ?? (/^https?:\/\//.test(text) || text.startsWith("sample:") ? text : "");
  }
  return row.cells[col] ?? "";
}

/** First non-empty values of a column, to tell columns apart in the mapping selects. */
function sampleOf(preview: SheetPreview, col: number): string {
  const seen = preview.rows.map((r) => r.cells[col]).filter(Boolean);
  const first = seen[0] ?? "";
  return first ? ` - e.g. "${first.length > 28 ? `${first.slice(0, 28)}…` : first}"` : " - (empty)";
}

/** Tab and header-row pickers: for plans with notes or titles above the headers, or several tabs. */
export function SheetLocator({ preview, disabled, onReload }: { preview: SheetPreview; disabled?: boolean; onReload: (tab: string, headerRow?: number) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Tab" hint={preview.tabs.length > 1 ? "The most plan-like tab is picked first." : undefined}>
        <select value={preview.tab} disabled={disabled} onChange={(e) => onReload(e.target.value)} className="max-w-[260px] rounded-md border px-2 py-1.5 text-xs" style={fieldStyle} aria-label="Sheet tab">
          {preview.tabs.map((t) => (
            <option key={`${t.gid}-${t.title}`} value={t.title}>
              {t.title}
              {t.score ? ` (${t.score} plan columns)` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Header row" hint="The row holding the column names.">
        <select
          value={preview.headerRow}
          disabled={disabled}
          onChange={(e) => onReload(preview.tab, Number(e.target.value))}
          className="max-w-[340px] rounded-md border px-2 py-1.5 text-xs"
          style={fieldStyle}
          aria-label="Header row"
        >
          {preview.topRows
            .filter((r) => r.preview || r.rowNumber === preview.headerRow)
            .map((r) => (
              <option key={r.rowNumber} value={r.rowNumber}>
                Row {r.rowNumber}: {r.preview || "(empty)"}
              </option>
            ))}
        </select>
      </Field>
    </div>
  );
}

/** Which column holds each field; columns are labelled with their header and a sample value. */
export function MappingGrid({
  preview,
  mapping,
  onChange,
  fields = FIELD_LABELS,
}: {
  preview: SheetPreview;
  mapping: Record<PlanField, number>;
  onChange: (mapping: Record<PlanField, number>) => void;
  fields?: typeof FIELD_LABELS;
}) {
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {group}
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {fields
              .filter((f) => f.group === group)
              .map(({ field, label }) => (
                <Field key={field} label={label}>
                  <select
                    value={mapping[field] ?? -1}
                    onChange={(e) => onChange({ ...mapping, [field]: Number(e.target.value) })}
                    className="w-full min-w-0 rounded-md border px-2 py-1 text-xs"
                    style={{ ...fieldStyle, ...(mapping[field] >= 0 ? {} : { color: "var(--text-muted)" }) }}
                  >
                    <option value={-1}>(not in this plan)</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                        {sampleOf(preview, i)}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export const matchedCount = (mapping: Record<PlanField, number>) => FIELD_LABELS.filter((f) => mapping[f.field] >= 0).length;
